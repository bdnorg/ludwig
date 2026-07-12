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
await page.click('.tmpl:has-text("Dominion")');
await page.click('button.primary:has-text("Start a new table")');
await page.waitForSelector('.viewport');
await settle();

const room = await page.evaluate(() => location.hash.replace('#/t/', ''));
const state = () => page.evaluate((r) => JSON.parse(localStorage.getItem(`ludwig:table:${r}`)), room);

let s = await state();
const decks = Object.values(s.entities).filter((e) => e.kind === 'mat' && e.config.placement.type === 'stack');
ok(decks.length === 22, `dominion table has 22 piles (got ${decks.length})`);
const cards = Object.values(s.entities).filter((e) => e.kind === 'card');
ok(cards.length === 308, `308 cards in play (got ${cards.length})`);

// supply piles show their top card's title (face up)
const villageVisible = await page.evaluate(() =>
  [...document.querySelectorAll('.face .title')].some((t) => t.textContent === 'Village'),
);
ok(villageVisible, 'Village supply pile renders its face-up top card');

// "buy": drag the top Copper off the supply — should land face up
const copper = decks.find((d) => d.config.label === 'Copper');
await page.mouse.move(copper.pos.x + 36, copper.pos.y + 50 + TOOLBAR);
await page.mouse.down();
await page.mouse.move(1100, 620 + TOOLBAR, { steps: 6 });
await page.mouse.up();
await settle();
s = await state();
const bought = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
const copperAfter = Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.label === 'Copper');
ok(
  bought?.config.front.title === 'Copper' && bought?.state.faceUp === true,
  'dragged top Copper off the supply, face up',
);
ok(copperAfter.state.order.length === 31, `Copper pile down to 31 (got ${copperAfter.state.order.length})`);

// starter deck: shuffle via context menu, then double-click 5 to hand
const starter = decks.find((d) => d.config.label === 'Starter deck 1');
await page.mouse.click(starter.pos.x + 36, starter.pos.y + 50 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Shuffle")');
await settle();
for (let i = 0; i < 5; i++) {
  await page.mouse.dblclick(starter.pos.x + 36, starter.pos.y + 50 + TOOLBAR);
  await page.waitForTimeout(150);
}
await settle();
s = await state();
const hand = Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.ownerId);
const inHand = Object.values(s.entities).filter((e) => e.kind === 'card' && e.parent === hand.id);
ok(inHand.length === 5, `drew opening hand of 5 (got ${inHand.length})`);
const titles = inHand.map((c) => c.config.front.title);
ok(titles.every((t) => t === 'Copper' || t === 'Estate'), `hand is starters only: ${titles.join(', ')}`);

await browser.close();
console.log('DONE');
