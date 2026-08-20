// Dominion template test: lobby gallery → full table; buy-like interactions.
import { chromium } from 'playwright-core';

const TOOLBAR = 44;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
const settle = () => page.waitForTimeout(700);

// through the lobby: name, pick Dominion, start
await page.goto('http://localhost:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.fill('input[placeholder="e.g. Beth"]', 'Dom');
// commit the name BEFORE clicking a tile: the first blur inserts the
// "Playing as" select, shifting the gallery mid-click (M20 lobby)
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
await page.click('.tmpl:has-text("Dominion")');
await page.click('button.primary:has-text("Start a new table")');
await page.waitForSelector('.viewport');
await settle();

const room = await page.evaluate(() => location.hash.replace('#/t/', ''));
const state = () => page.evaluate((r) => JSON.parse(localStorage.getItem(`ludwig:table:${r}`)), room);

let s = await state();
const decks = Object.values(s.entities).filter((e) => e.kind === 'mat' && e.config.placement.type === 'stack');
ok(decks.length === 26, `dominion table has 26 piles (got ${decks.length})`);
const cards = Object.values(s.entities).filter((e) => e.kind === 'card');
ok(cards.length === 308, `308 cards in play (got ${cards.length})`);
// v5: each player has a Deck N + empty Discard N pair
for (const n of [1, 2, 3, 4]) {
  const dk = decks.find((d) => d.config.label === `Deck ${n}`);
  const dc = decks.find((d) => d.config.label === `Discard ${n}`);
  ok(
    dk && dc && dc.state.order.length === 0,
    `Deck ${n} + empty Discard ${n} exist`,
  );
}

// M21 seat kits: the creator auto-claims seat 1 — Deck 1 + Discard 1 get
// their ownerId, the claim is logged, and the label wears the owner dot
const myId = (await page.evaluate(() => JSON.parse(localStorage.getItem('ludwig:player')))).id;
const deck1Ent = decks.find((d) => d.config.label === 'Deck 1');
const discard1Ent = decks.find((d) => d.config.label === 'Discard 1');
const deck2Ent = decks.find((d) => d.config.label === 'Deck 2');
ok(
  deck1Ent.config.ownerId === myId && discard1Ent.config.ownerId === myId,
  'creator auto-claimed seat 1 (owns Deck 1 + Discard 1)',
);
ok(
  !deck2Ent.config.ownerId,
  'seat 2 kit is still unowned',
);
ok(
  Object.values(s.log ?? {}).some((e) => e.text.includes('Dom took seat 1')),
  'seat claim was logged',
);
const deck1Label = await page.evaluate((id) => {
  const el = document.querySelector(`[data-entity-id="${id}"] .label`);
  return el ? { text: el.textContent.trim(), odot: !!el.querySelector('.odot') } : null;
}, deck1Ent.id);
ok(
  deck1Label?.text === 'Dom · Deck 1' && deck1Label.odot,
  `owned mat label carries name + color dot ("${deck1Label?.text}", odot=${deck1Label?.odot})`,
);

// supply piles show their top card's title (face up)
const villageVisible = await page.evaluate(() =>
  [...document.querySelectorAll('.face .title')].some((t) => t.textContent === 'Village'),
);
ok(villageVisible, 'Village supply pile renders its face-up top card');

// M20: inspector panel — hover a face-up pile opens it; v pins it, then the
// header bar moves it, the corner grip resizes it, and geometry persists
const village = decks.find((d) => d.config.label === 'Village');
await page.mouse.move(village.pos.x + 36, village.pos.y + 50 + TOOLBAR);
await page.waitForSelector('.inspector', { timeout: 3000 });
ok(true, 'hovering a face-up pile opened the inspector');
await page.keyboard.press('v');
await page.waitForSelector('.inspector.pinned', { timeout: 2000 });
const chrome = await page.evaluate(() => ({
  bar: !!document.querySelector('.inspector.pinned .bar'),
  grip: !!document.querySelector('.inspector.pinned .grip'),
  space: document.querySelector('.inspector.pinned .bar .space')?.textContent.trim(),
}));
ok(chrome.bar && chrome.grip, 'pinned inspector shows the drag bar and resize grip');
ok(chrome.space === '📌 screen', `pinned bar offers the park toggle ("${chrome.space}")`);

// drag the bar left+down: the panel follows the pointer delta (grab near the
// bar's left edge — the 📌 button sits mid-bar and swallows pointerdown, M21)
const panelBB = await page.locator('.inspector').boundingBox();
const barBB = await page.locator('.inspector .bar').boundingBox();
const barC = { x: barBB.x + 10, y: barBB.y + barBB.height / 2 };
await page.mouse.move(barC.x, barC.y);
await page.mouse.down();
await page.mouse.move(barC.x - 400, barC.y + 150, { steps: 8 });
await page.mouse.up();
const moved = await page.locator('.inspector').boundingBox();
ok(
  Math.abs(moved.x - (panelBB.x - 400)) < 8 && Math.abs(moved.y - (panelBB.y + 150)) < 8,
  `bar drag moved the panel (${Math.round(panelBB.x)},${Math.round(panelBB.y)} → ${Math.round(moved.x)},${Math.round(moved.y)})`,
);

// drag the grip right: the panel widens by the pointer delta
const gripBB = await page.locator('.inspector .grip').boundingBox();
const gripC = { x: gripBB.x + gripBB.width / 2, y: gripBB.y + gripBB.height / 2 };
await page.mouse.move(gripC.x, gripC.y);
await page.mouse.down();
await page.mouse.move(gripC.x + 80, gripC.y, { steps: 6 });
await page.mouse.up();
const resized = await page.locator('.inspector').boundingBox();
ok(
  Math.abs(resized.width - (moved.width + 80)) < 8,
  `grip drag widened the panel (${Math.round(moved.width)} → ${Math.round(resized.width)})`,
);

// geometry persists per browser under ludwig:inspector (default w was 210)
const savedPanel = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('ludwig:inspector') ?? 'null'),
);
ok(
  savedPanel &&
    Math.abs(savedPanel.x - moved.x) < 8 &&
    Math.abs(savedPanel.y - moved.y) < 8 &&
    Math.abs(savedPanel.w - 290) < 4,
  `panel geometry persisted (${JSON.stringify(savedPanel)})`,
);

// v toggles the pin off again (Escape unpins too)
await page.keyboard.press('v');
await page.waitForTimeout(150);
ok(
  await page.evaluate(() => !document.querySelector('.inspector.pinned')),
  'v unpinned the inspector',
);

// "buy" (v5): ⇧-drag the top Copper off the supply — should land face up
const copper = decks.find((d) => d.config.label === 'Copper');
await page.keyboard.down('Shift');
await page.mouse.move(copper.pos.x + 36, copper.pos.y + 50 + TOOLBAR);
await page.mouse.down();
await page.mouse.move(1100, 620 + TOOLBAR, { steps: 6 });
await page.mouse.up();
await page.keyboard.up('Shift');
await settle();
s = await state();
const bought = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
const copperAfter = Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.label === 'Copper');
ok(
  bought?.config.front.title === 'Copper' && bought?.state.faceUp === true,
  '⇧-dragged top Copper off the supply, face up',
);
ok(copperAfter.state.order.length === 31, `Copper pile down to 31 (got ${copperAfter.state.order.length})`);

// player deck: shuffle via context menu, then the count prefix (v5) draws
// the opening hand in one batch: hover, type 5 then d
const deck1 = decks.find((d) => d.config.label === 'Deck 1');
await page.mouse.click(deck1.pos.x + 36, deck1.pos.y + 50 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Shuffle")');
await settle();
await page.mouse.move(deck1.pos.x + 36, deck1.pos.y + 50 + TOOLBAR);
await page.keyboard.press('5');
await page.keyboard.press('d');
await settle();
s = await state();
// (seat kits also carry ownerId since M21 — find the hand by its id)
const hand = Object.values(s.entities).find((e) => e.kind === 'mat' && e.id.startsWith('hand_'));
const inHand = Object.values(s.entities).filter((e) => e.kind === 'card' && e.parent === hand.id);
ok(inHand.length === 5, `count prefix 5 d drew opening hand of 5 (got ${inHand.length})`);
const titles = inHand.map((c) => c.config.front.title);
ok(titles.every((t) => t === 'Copper' || t === 'Estate'), `hand is starters only: ${titles.join(', ')}`);
const deck1Left = () =>
  state().then((st) => st.entities[deck1.id].state.order.length);
ok((await deck1Left()) === 5, `Deck 1 down to 5 (got ${await deck1Left()})`);

// reshuffle button (v5): discard two cards, then Deck 1's ⟳ button sweeps
// Discard 1 back into the deck and shuffles
const discard1 = decks.find((d) => d.config.label === 'Discard 1');
/** ⇧-drag the deck's top card and release on the discard's bullseye
 *  (top-right ring, M17) — approach over the body so the ring appears. */
async function discardTop() {
  const bb = await page
    .locator(`[data-entity-id="${discard1.id}"]`)
    .boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(deck1.pos.x + 36, deck1.pos.y + 50 + TOOLBAR);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 6 });
  await page.mouse.move(bb.x + bb.width, bb.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}
await discardTop();
await discardTop();
await settle();
s = await state();
const discarded = s.entities[discard1.id].state.order.length;
ok(discarded === 2 && (await deck1Left()) === 3, `discarded 2 to Discard 1 (deck 3, discard ${discarded})`);

// M20: each Deck carries TWO buttons — ⟳ reshuffle and Draw 5
const btnLabels = await page.$$eval(`[data-entity-id="${deck1.id}"] .matbtns button`, (els) =>
  els.map((b) => b.textContent.trim()),
);
ok(
  btnLabels.length === 2 &&
    btnLabels.some((t) => t.includes('reshuffle')) &&
    btnLabels.includes('Draw 5'),
  `Deck 1 renders both buttons (${btnLabels.join(' | ')})`,
);
const reshuffleBtn = page.locator(`[data-entity-id="${deck1.id}"] .matbtns button`, {
  hasText: 'reshuffle',
});
await reshuffleBtn.click();
await settle();
s = await state();
ok(
  s.entities[discard1.id].state.order.length === 0 && (await deck1Left()) === 5,
  `⟳ reshuffled Discard 1 into Deck 1 (deck ${s.entities[deck1.id].state.order.length}, discard ${s.entities[discard1.id].state.order.length})`,
);

// M20: the Draw 5 button empties the 5-card deck into my hand — the 5 drawn
// earlier by the count prefix are still there, so the hand totals 10
await page.click(`[data-entity-id="${deck1.id}"] .matbtns button:has-text("Draw 5")`);
await settle();
s = await state();
const handNow = Object.values(s.entities).filter(
  (e) => e.kind === 'card' && e.parent === hand.id,
).length;
ok(
  handNow === 10 && (await deck1Left()) === 0,
  `Draw 5 button drew 5 more to my hand (hand ${handNow}, deck ${await deck1Left()})`,
);

// ---- M21: autoReshuffle — a short draw sweeps the linked discard in and
// shuffles first, all as ONE commit. Use the untouched seat-2 kit: put 5 of
// Deck 2's 10 cards on Discard 2, then draw 8 with only 5 left in the deck.
const deck2 = decks.find((d) => d.config.label === 'Deck 2');
const discard2 = decks.find((d) => d.config.label === 'Discard 2');
ok(
  await page.evaluate(
    (id) => document.querySelector(`[data-entity-id="${id}"] .linkchip`)?.textContent === '⟳',
    deck2.id,
  ),
  'Deck 2 renders the ⟳ autoReshuffle link chip',
);

// hovering the chip outlines the linked mat (class "hinted")
await page.hover(`[data-entity-id="${deck2.id}"] .linkchip`);
await page.waitForTimeout(150);
ok(
  await page.evaluate(
    (id) => document.querySelector(`[data-entity-id="${id}"]`)?.classList.contains('hinted'),
    discard2.id,
  ),
  'hovering the ⟳ chip outlines the linked Discard 2',
);
await page.mouse.move(400, 880); // off the chip
await page.waitForTimeout(150);

// move 5 cards Deck 2 → Discard 2 by bullseye drops (deterministic setup)
const dc2bb = await page.locator(`[data-entity-id="${discard2.id}"]`).boundingBox();
for (let i = 0; i < 5; i++) {
  await page.keyboard.down('Shift');
  await page.mouse.move(deck2.pos.x + 36, deck2.pos.y + 50 + TOOLBAR);
  await page.mouse.down();
  await page.mouse.move(dc2bb.x + dc2bb.width / 2, dc2bb.y + dc2bb.height / 2, { steps: 5 });
  await page.mouse.move(dc2bb.x + dc2bb.width, dc2bb.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}
await settle();
s = await state();
ok(
  s.entities[deck2.id].state.order.length === 5 &&
    s.entities[discard2.id].state.order.length === 5,
  `staged the link: Deck 2 has 5, Discard 2 has 5 (${s.entities[deck2.id].state.order.length}/${s.entities[discard2.id].state.order.length})`,
);

// draw 8 from a 5-card deck: the discard sweeps in, shuffles, and the draw
// completes — hand 10 → 18, both mats emptied into it
const handBefore = Object.values(s.entities).filter((e) => e.parent === hand.id).length;
await page.mouse.move(deck2.pos.x + 36, deck2.pos.y + 50 + TOOLBAR);
await page.keyboard.press('8');
await page.keyboard.press('d');
await settle();
s = await state();
const handAfterAuto = Object.values(s.entities).filter((e) => e.parent === hand.id).length;
ok(
  handAfterAuto === handBefore + 8 &&
    s.entities[deck2.id].state.order.length === 2 &&
    s.entities[discard2.id].state.order.length === 0,
  `8 d auto-reshuffled and drew (hand ${handBefore}→${handAfterAuto}, deck ${s.entities[deck2.id].state.order.length}, discard ${s.entities[discard2.id].state.order.length})`,
);
ok(
  Object.values(s.log ?? {}).some((e) => e.text.includes('(auto)') && e.text.includes('Discard 2')),
  'auto-reshuffle hit the log',
);

// ONE commit: a single undo restores deck, discard, and hand together
await page.click('.toolbar button:has-text("undo")');
await settle();
s = await state();
ok(
  s.entities[deck2.id].state.order.length === 5 &&
    s.entities[discard2.id].state.order.length === 5 &&
    Object.values(s.entities).filter((e) => e.parent === hand.id).length === handBefore,
  `one undo reversed sweep+shuffle+draw together (deck ${s.entities[deck2.id].state.order.length}, discard ${s.entities[discard2.id].state.order.length})`,
);

// ---- M21: inspector felt-park toggle — pinned panel parks on screen (stays
// put through pans) or on the felt (tracks the table). LAST: it pans the view.
const village2 = decks.find((d) => d.config.label === 'Village');
await page.mouse.move(village2.pos.x + 36, village2.pos.y + 50 + TOOLBAR);
await page.waitForSelector('.inspector', { timeout: 3000 });
await page.keyboard.press('v');
await page.waitForSelector('.inspector.pinned', { timeout: 2000 });

/** find an empty felt point (no entity/chrome under it) to start a pan */
const emptyFeltPoint = () =>
  page.evaluate(() => {
    const clear = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return (
        el &&
        !el.closest('.entity') &&
        !el.closest('.tray') &&
        !el.closest('.inspector') &&
        !el.closest('.toolbar') &&
        !el.closest('.roster') &&
        !el.closest('.logpanel') &&
        !el.closest('.quickbar')
      );
    };
    for (const [x, y] of [[60, 880], [200, 880], [1440, 880], [60, 500], [740, 470], [1440, 300]])
      if (clear(x, y)) return { x, y };
    return null;
  });

async function pan(dx, dy) {
  const p = await emptyFeltPoint();
  await page.keyboard.down('Shift');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
}

// park on the felt: the toggle flips its label and the panel now pans along
await page.click('.inspector .bar .space');
await page.waitForTimeout(150);
const spaceLabel = await page.evaluate(() =>
  document.querySelector('.inspector .bar .space')?.textContent.trim(),
);
ok(spaceLabel === '📌 felt', `park toggle switched to the felt ("${spaceLabel}")`);
const feltBB = await page.locator('.inspector').boundingBox();
await pan(120, 70);
const feltBB2 = await page.locator('.inspector').boundingBox();
ok(
  Math.abs(feltBB2.x - (feltBB.x + 120)) < 10 && Math.abs(feltBB2.y - (feltBB.y + 70)) < 10,
  `felt-parked panel moved with the pan (${Math.round(feltBB.x)},${Math.round(feltBB.y)} → ${Math.round(feltBB2.x)},${Math.round(feltBB2.y)})`,
);

// park back on screen: the panel stays put through the next pan
await page.click('.inspector .bar .space');
await page.waitForTimeout(150);
ok(
  (await page.evaluate(() =>
    document.querySelector('.inspector .bar .space')?.textContent.trim(),
  )) === '📌 screen',
  'park toggle switched back to the screen',
);
const screenBB = await page.locator('.inspector').boundingBox();
await pan(80, 50);
const screenBB2 = await page.locator('.inspector').boundingBox();
ok(
  Math.abs(screenBB2.x - screenBB.x) < 3 && Math.abs(screenBB2.y - screenBB.y) < 3,
  `screen-parked panel ignored the pan (${Math.round(screenBB.x)},${Math.round(screenBB.y)} → ${Math.round(screenBB2.x)},${Math.round(screenBB2.y)})`,
);

await browser.close();
console.log('DONE');
