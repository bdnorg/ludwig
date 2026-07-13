// Toolkit + mats verification: dice, counter, scoreboard, timer, chips,
// mat entry rules, stack pulls, undo. State reads come from the localStorage
// autosave, which is debounced 400ms — always settle >600ms before asserting.
import { chromium } from 'playwright-core';

const ROOM = 'test-m4-' + Math.random().toString(36).slice(2, 8);
const TOOLBAR = 44; // table y -> screen y offset (view starts untransformed)
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('console', (m) => m.type() === 'error' && console.log('[console.error]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://localhost:5173/');
await page.evaluate(() => {
  localStorage.setItem('ludwig:player', JSON.stringify({ id: 'p_tester', name: 'Tester', color: '#3d9be4' }));
});
await page.goto(`http://localhost:5173/#/t/${ROOM}`);
await page.waitForSelector('.viewport');

const settle = () => page.waitForTimeout(700);
const state = () => page.evaluate((room) => JSON.parse(localStorage.getItem(`ludwig:table:${room}`)), ROOM);
const finders = {
  token: (s) => Object.values(s.entities).find((e) => e.kind === 'token'),
  // chip piles are implicit stack mats since M17
  pile: (s) => Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.implicit),
  dice: (s) => Object.values(s.entities).find((e) => e.kind === 'dice'),
  counter: (s) => Object.values(s.entities).find((e) => e.kind === 'counter'),
  scoreboard: (s) => Object.values(s.entities).find((e) => e.kind === 'scoreboard'),
  timer: (s) => Object.values(s.entities).find((e) => e.kind === 'timer'),
  zone: (s) =>
    Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.label === 'Play area'),
  deck: (s) =>
    Object.values(s.entities).find(
      (e) => e.kind === 'mat' && e.config.placement.type === 'stack' && !e.config.implicit,
    ),
};
const find = (s, kind) => finders[kind](s);
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);

async function drag(from, to, { alt = false } = {}) {
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

/** Move an entity by its hover move-handle (piles/mats never body-drag, M13).
 *  ONE handle since M17: bottom-center (.h-s); the hover-button bar owns the
 *  top edge. */
async function dragByHandle(e, dx, dy, hover = { dx: 10, dy: 10 }) {
  await page.mouse.move(e.pos.x + hover.dx, e.pos.y + hover.dy + TOOLBAR); // reveal handles
  const bb = await page.locator(`[data-entity-id="${e.id}"] .h-s`).boundingBox();
  const c = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
  await drag(c, { x: c.x + dx, y: c.y + dy });
}

/** Drop the pointer on an entity's bullseye (top-right ring, M17): approach
 *  over the body so the ring appears, then release on the ring. */
async function dropOnBullseye(from, targetId) {
  const bb = await page.locator(`[data-entity-id="${targetId}"]`).boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.move(bb.x + bb.width, bb.y, { steps: 4 });
  await page.mouse.up();
}

/** spawn from the palette, then move the new entity to (tx, ty) — piles and
 *  mats by their handles, plain items by body drag */
async function spawnAt(label, kind, tx, ty, grab = { dx: 10, dy: 10 }) {
  await page.click('.toolbar button.primary');
  await page.click(`.menu button:has-text("${label}")`);
  await settle();
  const e = find(await state(), kind);
  if (kind === 'deck' || kind === 'pile' || kind === 'zone') {
    await dragByHandle(e, tx - e.pos.x, ty - e.pos.y, grab);
  } else {
    await drag(
      { x: e.pos.x + grab.dx, y: e.pos.y + grab.dy + TOOLBAR },
      { x: tx + grab.dx, y: ty + grab.dy + TOOLBAR },
    );
  }
  await settle();
  return find(await state(), kind);
}

// lay the toolkit out on a grid so nothing overlaps
const chip = await spawnAt('Chips $5', 'pile', 150, 550, { dx: 17, dy: 17 });
const dice = await spawnAt('Die (d6)', 'dice', 350, 560, { dx: 20, dy: 20 });
await spawnAt('Counter', 'counter', 550, 550, { dx: 46, dy: 8 });
await spawnAt('Scoreboard', 'scoreboard', 800, 520, { dx: 60, dy: 8 });
await spawnAt('Timer', 'timer', 1050, 550, { dx: 60, dy: 12 });
const zone = await spawnAt('cards enter face down', 'zone', 700, 100, { dx: 40, dy: 8 });
const deck = await spawnAt('52-card deck', 'deck', 150, 250, { dx: 36, dy: 50 });

let s = await state();
ok(
  ['token', 'dice', 'counter', 'scoreboard', 'timer', 'zone', 'deck'].every((k) => find(s, k)),
  'all toolkit kinds spawned and laid out',
);

// dice: double-click rolls
await page.mouse.dblclick(dice.pos.x + 20, dice.pos.y + 20 + TOOLBAR);
await settle();
s = await state();
ok(
  find(s, 'dice').state.rolledBy === 'p_tester' &&
    find(s, 'dice').state.values.every((v) => v >= 1 && v <= 6) &&
    find(s, 'dice').state.rolledAt > 0,
  `dice rolled: ${find(s, 'dice').state.values}`,
);

// counter: + twice, − once
const plus = page.locator('.counter button', { hasText: '+' });
await plus.click();
await plus.click();
await page.locator('.counter button', { hasText: '−' }).click();
await settle();
s = await state();
ok(find(s, 'counter').state.value === 1, 'counter at 1 after +,+,−');

// scoreboard: my row +
await page.locator('.board .row button', { hasText: '+' }).first().click();
await settle();
s = await state();
ok(find(s, 'scoreboard').state.values['p_tester'] === 1, 'scoreboard row incremented');

// timer: start, wait, pause
await page.locator('.timer button').first().click();
await page.waitForTimeout(1200);
await page.locator('.timer button').first().click();
await settle();
s = await state();
ok(
  !find(s, 'timer').state.running && find(s, 'timer').state.elapsedMs >= 1000,
  `timer paused at ${find(s, 'timer').state.elapsedMs}ms`,
);

// chips (M17): a pile is an implicit stack mat of 20 single chips.
// Body-drag pulls ONE off; only the bullseye merges it back.
const inPile = (st) => Object.values(st.entities).filter((e) => e.parent === chip.id);
const looseTok = (st) =>
  Object.values(st.entities).filter((e) => e.kind === 'token' && e.parent === null);
ok(inPile(s).length === 20, `chip pile holds 20 single chips (${inPile(s).length})`);

await drag(
  { x: chip.pos.x + 17, y: chip.pos.y + 17 + TOOLBAR },
  { x: chip.pos.x + 117, y: chip.pos.y + 17 + TOOLBAR },
);
await settle();
s = await state();
ok(
  inPile(s).length === 19 && looseTok(s).length === 1,
  'body drag pulled one chip off the pile',
);

// a plain overlap drop does NOT merge (M17: no implicit merge)
let lc = looseTok(s)[0];
await drag(
  { x: lc.pos.x + 17, y: lc.pos.y + 17 + TOOLBAR },
  { x: chip.pos.x + 12, y: chip.pos.y + 26 + TOOLBAR },
);
await settle();
s = await state();
ok(
  inPile(s).length === 19 && looseTok(s).length === 1,
  'overlap drop only overlapped — no merge without the bullseye',
);

// dropping ON the bullseye merges it back
lc = looseTok(s)[0];
await dropOnBullseye({ x: lc.pos.x + 17, y: lc.pos.y + 17 + TOOLBAR }, chip.id);
await settle();
s = await state();
ok(
  inPile(s).length === 20 && looseTok(s).length === 0,
  `bullseye drop merged the chip back (pile of ${inPile(s).length})`,
);

// mat entry rule: draw a card face up, then drag it into the face-down mat —
// it re-parents into the mat and flips down on entry
await page.mouse.click(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Draw face up")');
await settle();
s = await state();
let card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === true, 'drew a card face up beside the deck');

const zc = {
  x: zone.pos.x + zone.config.size.w / 2,
  y: zone.pos.y + zone.config.size.h / 2 + TOOLBAR,
};
await drag({ x: card.pos.x + 36, y: card.pos.y + 50 + TOOLBAR }, zc);
await settle();
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === zone.id);
ok(!!card && card.state.faceUp === false, 'card re-parented into the mat and flipped face down');

// ...and moving it within the mat must NOT re-flip after a manual flip up
const inZone = () => ({
  x: zone.pos.x + card.pos.x + 36,
  y: zone.pos.y + card.pos.y + 50 + TOOLBAR,
});
let at = inZone();
await page.mouse.dblclick(at.x, at.y);
await settle();
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === zone.id);
ok(card.state.faceUp === true, 'double-click flipped it back up inside the mat');
at = inZone();
await drag(at, { x: at.x + 30, y: at.y + 15 });
await settle();
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === zone.id);
ok(card.state.faceUp === true, 'moving within the mat does not re-flip the card');

// stack pull: plain-dragging a deck pulls its top card (face down, hidden faces)
const cardsLooseBefore = Object.values(s.entities).filter(
  (e) => e.kind === 'card' && e.parent === null,
).length;
await drag({ x: deck.pos.x + 36, y: deck.pos.y + 50 + TOOLBAR }, { x: 500, y: 400 + TOOLBAR });
await settle();
s = await state();
const loose = Object.values(s.entities).filter((e) => e.kind === 'card' && e.parent === null);
const pulled = loose.find((c) => Math.abs(c.pos.x + 36 - 500) < 20);
ok(
  loose.length === cardsLooseBefore + 1 && pulled && pulled.state.faceUp === false,
  'stack drag pulled top card, face down',
);

// undo returns it to the deck
const deckCount = () => page.evaluate((id) => document.querySelector(`[data-entity-id="${id}"] .count`)?.textContent, deck.id);
const before = await deckCount();
await page.click('.toolbar button:has-text("undo")');
await settle();
s = await state();
const looseAfter = Object.values(s.entities).filter((e) => e.kind === 'card' && e.parent === null);
ok(
  looseAfter.length === cardsLooseBefore && Number(await deckCount()) === Number(before) + 1,
  `undo returned the pulled card to the deck (${before} → ${await deckCount()})`,
);

// M8: keyboard — hover the deck, press d to draw to hand
await page.mouse.move(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR);
await page.keyboard.press('d');
await settle();
s = await state();
const hand = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.ownerId === 'p_tester',
);
ok(
  Object.values(s.entities).filter((e) => e.parent === hand.id).length === 1,
  'pressed d over the deck: drew to hand',
);

// M8: send-to sequence — hover the hand card in the tray? send works on table
// items: hover the pulled... use the deck: press s then the zone's letter
await page.mouse.move(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR);
await page.keyboard.press('s');
await page.waitForTimeout(200);
const hintShown = await page.evaluate(() => !!document.querySelector('.sendhint'));
const zoneLetter = await page.evaluate(() => {
  // letters are deterministic: recompute like the app does is overkill — read the badge
  const badges = [...document.querySelectorAll('.letter')];
  return badges.length > 0;
});
ok(hintShown && zoneLetter, 'send-to mode shows hint and mat letters');
await page.keyboard.press('p'); // "Play area" mat letter (label starts with p)
await settle();
s = await state();
const zoneItems = Object.values(s.entities).filter((e) => e.parent === zone.id);
ok(zoneItems.length === 2, `s+p sent the deck's top card to the Play area mat (${zoneItems.length} items)`);

// M8: command palette opens on Space and lists actions for hovered entity
await page.mouse.move(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR);
await page.keyboard.press(' ');
await page.waitForTimeout(300);
const paletteActions = await page.evaluate(() =>
  [...document.querySelectorAll('.palette .list button span')].map((b) => b.textContent),
);
ok(
  paletteActions.some((a) => a.includes('Shuffle')) && paletteActions.some((a) => a.includes('Draw')),
  `palette lists deck actions: ${paletteActions.slice(0, 4).join(', ')}…`,
);
await page.keyboard.press('Escape');

// M7/M11: privacy changes go through the Mat settings dialog and hit the log
// (the deck starts as backs — nobody sees faces; open it up to everyone)
await page.mouse.click(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Mat settings")');
await page.selectOption('[data-field="privacy"]', 'public');
await page.click('.dialog button:has-text("Save")');
await settle();
s = await state();
const deckAfterVis = Object.values(s.entities).find((e) => e.id === deck.id);
ok(
  deckAfterVis.config.visibility.faces === 'public' && deckAfterVis.config.privacy === 'public',
  'settings dialog opened the deck faces to everyone',
);
const logTexts = Object.values(s.log ?? {}).map((e) => e.text);
ok(
  logTexts.some((t) => t.includes('faces visible to everyone')),
  `visibility change logged: "${logTexts[0] ?? ''}"`,
);

// M10: browser title carries the table name
const title = await page.title();
ok(title === `ludwig – ${ROOM}`, `browser title is "${title}"`);

// M10: hovering a stack shows the gesture hint alongside the hover buttons
await page.mouse.move(0, 0);
await page.waitForTimeout(400);
await page.mouse.move(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR);
await page.waitForTimeout(200);
const hint = await page.evaluate(() => document.querySelector('.gesturehint')?.textContent);
ok(hint?.includes('take one'), `stack gesture hint shown: "${hint}"`);

// M10: hover buttons survive the pointer moving onto them (250ms grace)
const barBtn = await page.evaluate(() => {
  const b = document.querySelector('.hoverbar .buttons button');
  const r = b?.getBoundingClientRect();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
await page.mouse.move(barBtn.x, barBtn.y, { steps: 4 });
await page.waitForTimeout(400);
ok(
  await page.evaluate(() => !!document.querySelector('.hoverbar')),
  'hover buttons still present with the pointer on them',
);

// M10: ] brings to front, [ sends to back
s = await state();
const chipNow = find(s, 'pile');
const zBefore = chipNow.pos.z;
await page.mouse.move(chipNow.pos.x + 17, chipNow.pos.y + 17 + TOOLBAR);
await page.keyboard.press(']');
await settle();
s = await state();
ok(find(s, 'pile').pos.z > zBefore, `] raised z (${zBefore} → ${find(s, 'pile').pos.z})`);
await page.keyboard.press('[');
await settle();
s = await state();
ok(find(s, 'pile').pos.z < zBefore, `[ lowered z below all (${find(s, 'pile').pos.z})`);

// M10: reorder within the hand tray by dragging a card to the other end
await page.mouse.move(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR);
await page.keyboard.press('d'); // a second card, so there is an order to change
await settle();
s = await state();
const handMat = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.ownerId === 'p_tester',
);
const orderBefore = [...handMat.state.order];
ok(orderBefore.length === 2, `hand holds 2 cards (${orderBefore.length})`);
const slotRects = await page.$$eval('.tray .slot', (els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.cardId, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }),
);
const first = slotRects.find((r) => r.id === orderBefore[0]);
const last = slotRects[slotRects.length - 1];
await drag({ x: first.x, y: first.y }, { x: last.x + 60, y: last.y });
await settle();
s = await state();
const orderAfter = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.ownerId === 'p_tester',
).state.order;
ok(
  orderAfter[orderAfter.length - 1] === orderBefore[0] && orderAfter.length === 2,
  `tray drag reordered the hand (${orderBefore.join()} → ${orderAfter.join()})`,
);

// M11: annotations live on any entity (📝 via the context menu)
s = await state();
const diceEnt = find(s, 'dice');
page.once('dialog', (d) => d.accept('roll me at dawn'));
await page.mouse.click(diceEnt.pos.x + 20, diceEnt.pos.y + 20 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Annotation")');
await settle();
s = await state();
ok(find(s, 'dice').annotation === 'roll me at dawn', 'annotation stored on the dice');

// M11: unpin my hand — it appears on the table as an ordinary fan mat
await page.click('.tray .pinmat button:has-text("unpin")');
await page.waitForTimeout(300);
const handOnTable = await page.evaluate(() => !!document.querySelector('[data-entity-id^="hand_"]'));
const trayGone = await page.evaluate(() => !document.querySelector('.tray'));
ok(handOnTable && trayGone, 'unpinned hand renders on the table; tray hides');
const bb = await page.locator('[data-entity-id^="hand_"]').boundingBox();
await page.mouse.click(bb.x + 12, bb.y + 8, { button: 'right' });
await page.click('.menu button:has-text("Pin to my tray")');
await page.waitForTimeout(300);
ok(
  await page.evaluate(() => !!document.querySelector('.tray .pinmat')),
  'pinned the hand back into the tray',
);

// M11: the table root is a mat — right-click the felt for its settings
s = await state();
ok(!!s.entities['mat_table'], 'root table mat exists');
await page.mouse.click(420, 180 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Table settings")');
await page.selectOption('[data-field="placement"]', 'hexgrid');
await page.click('.dialog button:has-text("Save")');
await settle();
s = await state();
const rootAfter = s.entities['mat_table'];
ok(
  rootAfter.config.placement.type === 'grid' && rootAfter.config.placement.grid.hex === true,
  'felt gained a hex grid via Table settings',
);
ok(
  await page.evaluate(() => !!document.querySelector('.feltgrid')),
  'hex grid renders on the felt',
);

// ---- M13: selection, rubber-band, multi-move ----

// rubber-band on plain felt drag: sweep over the chip and the dice
s = await state();
const chipSel = find(s, 'pile');
const diceSel = find(s, 'dice');
await drag({ x: 60, y: 480 + TOOLBAR }, { x: 460, y: 640 + TOOLBAR });
await page.waitForTimeout(200);
const selCount = await page.evaluate(() => document.querySelectorAll('.entity.selected').length);
ok(selCount === 2, `rubber-band selected the chip stack and the dice (${selCount})`);

// dragging one member moves the whole selection rigidly, one undo
const posBefore = { chip: { ...chipSel.pos }, dice: { ...diceSel.pos } };
await drag(
  { x: chipSel.pos.x + 17, y: chipSel.pos.y + 17 + TOOLBAR },
  { x: chipSel.pos.x + 97, y: chipSel.pos.y - 43 + TOOLBAR },
);
await settle();
s = await state();
const chipMoved = find(s, 'pile');
const diceMoved = find(s, 'dice');
ok(
  Math.abs(chipMoved.pos.x - posBefore.chip.x - 80) < 3 &&
    Math.abs(diceMoved.pos.x - posBefore.dice.x - 80) < 3 &&
    Math.abs(diceMoved.pos.y - posBefore.dice.y + 60) < 3,
  'multi-drag translated both members rigidly',
);
await page.keyboard.press('Escape'); // clear selection
await page.click('.toolbar button:has-text("undo")');
await settle();
s = await state();
ok(
  find(s, 'pile').pos.x === posBefore.chip.x && find(s, 'dice').pos.x === posBefore.dice.x,
  'one undo reversed the whole multi-move',
);

// ⌘-click toggles selection membership (Meta: ctrl+click is contextmenu on mac)
await page.keyboard.down('Meta');
await page.mouse.click(posBefore.chip.x + 17, posBefore.chip.y + 17 + TOOLBAR);
await page.mouse.click(posBefore.dice.x + 20, posBefore.dice.y + 20 + TOOLBAR);
await page.keyboard.up('Meta');
await page.waitForTimeout(150);
let selNow = await page.evaluate(() => document.querySelectorAll('.entity.selected').length);
ok(selNow === 2, `ctrl-click built a 2-item selection (${selNow})`);
await page.keyboard.down('Meta');
await page.mouse.click(posBefore.dice.x + 20, posBefore.dice.y + 20 + TOOLBAR);
await page.keyboard.up('Meta');
await page.waitForTimeout(150);
selNow = await page.evaluate(() => document.querySelectorAll('.entity.selected').length);
ok(selNow === 1, `ctrl-click toggled one back out (${selNow})`);
await page.keyboard.press('Escape');

// keys act on the selection: band over the zone's two cards, f flips both
s = await state();
const zCards = Object.values(s.entities).filter((e) => e.kind === 'card' && e.parent === zone.id);
const facesBefore = Object.fromEntries(zCards.map((c) => [c.id, c.state.faceUp]));
await drag({ x: zone.pos.x - 10, y: zone.pos.y - 10 + TOOLBAR }, {
  x: zone.pos.x + zone.config.size.w + 10,
  y: zone.pos.y + zone.config.size.h + 10 + TOOLBAR,
});
await page.waitForTimeout(200);
await page.keyboard.press('f');
await settle();
s = await state();
ok(
  zCards.every((c) => s.entities[c.id].state.faceUp === !facesBefore[c.id]),
  'f flipped every selected card in one step',
);
await page.keyboard.press('Escape');

// ---- M14: dice tray, mat buttons, values, item settings ----

// spawn a dice tray: two single-die entities on a mat with a Roll button
await page.click('.toolbar button.primary');
await page.click('.menu button:has-text("Dice tray")');
await settle();
s = await state();
let tray = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.label === 'Dice tray',
);
// park the tray on empty felt so nothing intercepts its Roll button
await dragByHandle(tray, 60 - tray.pos.x, 700 - tray.pos.y, { dx: 40, dy: 10 });
await settle();
s = await state();
tray = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.label === 'Dice tray',
);
let trayDice = Object.values(s.entities).filter((e) => e.kind === 'dice' && e.parent === tray.id);
ok(
  trayDice.length === 2 && trayDice.every((d) => d.config.sides === 6 && d.state.values.length === 1),
  'dice tray spawned with two single-die entities',
);
await page.click(`[data-entity-id="${tray.id}"] .matbtns button`);
await settle();
s = await state();
ok(
  Object.values(s.entities).filter(
    (e) => e.kind === 'dice' && e.parent === tray.id && e.state.rolledAt > 0,
  ).length === 2,
  'the tray Roll button rolled both dice',
);

// chip piles show their value total via the mat Σ badge (20 × $5 = 100)
const badges = await page.evaluate(() =>
  [...document.querySelectorAll('.sumbadge')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
);
ok(badges.some((t) => t.includes('100')), `chip pile shows value total (${badges.join(' | ')})`);

// item settings: retype a die to d20 through the dialog
const die0 = trayDice[0];
await page.locator(`[data-entity-id="${die0.id}"]`).click({ button: 'right' });
await page.click('.menu button:has-text("Item settings")');
await page.fill('[data-field="sides"]', '20');
await page.click('.dialog button:has-text("Save")');
await settle();
s = await state();
ok(s.entities[die0.id].config.sides === 20, 'item settings changed the die to d20');

// duplicate clones the die beside the original, inside the same mat
await page.locator(`[data-entity-id="${die0.id}"]`).click({ button: 'right' });
await page.click('.menu button:has-text("Duplicate")');
await settle();
s = await state();
ok(
  Object.values(s.entities).filter((e) => e.kind === 'dice' && e.parent === tray.id).length === 3,
  'duplicate cloned the die on the tray',
);

// alt-drag bypasses the grid snap inside a grid mat (use the card sitting
// mid-zone — the one at the zone's origin is half under the mat edge)
s = await state();
const zcard = Object.values(s.entities)
  .filter((e) => e.kind === 'card' && e.parent === zone.id)
  .sort((a, b) => b.pos.x - a.pos.x)[0];
const zat = { x: zone.pos.x + zcard.pos.x + 36, y: zone.pos.y + zcard.pos.y + 50 + TOOLBAR };
await drag(zat, { x: zat.x + 13, y: zat.y + 7 }, { alt: true });
await settle();
s = await state();
ok(s.entities[zcard.id].pos.x % 40 !== 0, `alt-drag skipped the grid snap (x=${s.entities[zcard.id].pos.x})`);

// ---- M15: infinite supply — pulls clone, returns vanish ----
s = await state();
const nBefore = Object.values(s.entities).find((e) => e.id === deck.id).state.order.length;
const cardsBefore = Object.values(s.entities).filter((e) => e.kind === 'card').length;
await page.mouse.click(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Mat settings")');
await page.selectOption('[data-field="supply"]', 'infinite');
await page.click('.dialog button:has-text("Save")');
await settle();
const infBadge = await page.evaluate(
  (id) => document.querySelector(`[data-entity-id="${id}"] .count`)?.textContent,
  deck.id,
);
ok(infBadge === '∞', `supply badge shows ∞ (${infBadge})`);
await drag({ x: deck.pos.x + 36, y: deck.pos.y + 50 + TOOLBAR }, { x: 480, y: 300 + TOOLBAR });
await settle();
s = await state();
const nAfter = Object.values(s.entities).find((e) => e.id === deck.id).state.order.length;
const minted = Object.values(s.entities).filter((e) => e.kind === 'card').length - cardsBefore;
ok(
  nAfter === nBefore && minted === 1,
  `pull minted a clone, pile untouched (deck ${nBefore}→${nAfter}, +${minted} card)`,
);
const clone = Object.values(s.entities).find(
  (e) => e.kind === 'card' && e.parent === null && Math.abs(e.pos.x + 36 - 480) < 30,
);
// returns go through the bullseye too (M17): drop the clone ON the ring
await dropOnBullseye({ x: clone.pos.x + 36, y: clone.pos.y + 50 + TOOLBAR }, deck.id);
await settle();
s = await state();
ok(
  !s.entities[clone.id] &&
    Object.values(s.entities).filter((e) => e.kind === 'card').length === cardsBefore,
  'returning to the supply destroyed the card',
);

// ---- M16: private mats + clear-log watermark ----

// make the zone private: owner ring, per-viewer placement, logged change
await page.locator(`[data-entity-id="${zone.id}"]`).click({
  button: 'right',
  position: { x: 10, y: zone.config.size.h - 14 }, // bottom-left: clear of cards at (0,0)
});
await page.click('.menu button:has-text("Mat settings")');
await page.selectOption('[data-field="privacy"]', 'backs');
await page.click('.dialog button:has-text("Save")');
await settle();
s = await state();
const zpriv = Object.values(s.entities).find((e) => e.id === zone.id);
ok(
  zpriv.config.visibility.faces === 'owner' &&
    zpriv.config.ownerId === 'p_tester' &&
    zpriv.positioning === 'arbitrary' &&
    zpriv.config.visibility.positions === 'owner',
  'private mat: owner set, positions hidden, per-viewer placement',
);
ok(
  await page.evaluate(
    (id) => document.querySelector(`[data-entity-id="${id}"]`)?.classList.contains('priv-mine'),
    zone.id,
  ),
  'my private mat renders with the thick owner ring',
);

// clear-log: the shared log empties for everyone via the LWW watermark
s = await state();
ok(Object.keys(s.log ?? {}).length > 0, 'log has entries before clearing');
await page.click('.logpanel .head');
await page.click('.logpanel .clear');
await settle();
s = await state();
ok(
  Object.keys(s.log ?? {}).length === 0 && s.logCleared?.at > 0,
  'clear log emptied the shared log via the watermark',
);
await page.click('.logpanel .head');

// shift-drag pans the felt (kept out of the way until the end: it moves the
// coordinate frame)
const viewBefore = await page.evaluate(
  () => document.querySelector('.surface').style.transform,
);
await page.keyboard.down('Shift');
await drag({ x: 500, y: 400 + TOOLBAR }, { x: 560, y: 430 + TOOLBAR });
await page.keyboard.up('Shift');
const viewAfter = await page.evaluate(
  () => document.querySelector('.surface').style.transform,
);
ok(viewBefore !== viewAfter, `shift-drag panned the view (${viewAfter})`);

await browser.close();
console.log('DONE');
