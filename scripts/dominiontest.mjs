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
}));
ok(chrome.bar && chrome.grip, 'pinned inspector shows the drag bar and resize grip');

// drag the bar left+down: the panel follows the pointer delta
const panelBB = await page.locator('.inspector').boundingBox();
const barBB = await page.locator('.inspector .bar').boundingBox();
const barC = { x: barBB.x + barBB.width / 2, y: barBB.y + barBB.height / 2 };
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
const hand = Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.ownerId);
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

await browser.close();
console.log('DONE');
