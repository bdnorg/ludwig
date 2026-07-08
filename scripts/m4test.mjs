// M4 toolkit verification: dice, counter, scoreboard, timer, zones, chips.
import { chromium } from 'playwright-core';

const ROOM = 'test-m4-' + Math.random().toString(36).slice(2, 8);
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

const state = () => page.evaluate((room) => JSON.parse(localStorage.getItem(`ludwig:table:${room}`)), ROOM);
const spawnItem = async (label) => {
  await page.click('.toolbar button.primary');
  await page.click(`.menu button:has-text("${label}")`);
  await page.waitForTimeout(500);
};
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);

// spawn one of everything
for (const l of ['Chips $5', 'Two dice', 'Counter', 'Scoreboard', 'Timer', 'Face-down zone', '52-card deck'])
  await spawnItem(l);
let s = await state();
const kinds = Object.values(s.entities).map((e) => e.kind);
ok(
  ['token', 'dice', 'counter', 'scoreboard', 'timer', 'zone', 'deck'].every((k) => kinds.includes(k)),
  `all toolkit kinds spawned (${kinds.filter((k) => k !== 'card').join(', ')})`,
);
const centered = Object.values(s.entities).every(
  (e) => e.kind === 'hand' || e.kind === 'card' || (Math.abs(e.pos.x - 700) < 300 && Math.abs(e.pos.y - 430) < 300),
);
ok(centered, 'spawns land near the view center');

// dice: double-click rolls
await page.dblclick('.dice');
await page.waitForTimeout(300);
s = await state();
const dice = Object.values(s.entities).find((e) => e.kind === 'dice');
ok(dice.state.rolledBy === 'p_tester' && dice.state.values.every((v) => v >= 1 && v <= 6), `dice rolled: ${dice.state.values}`);

// counter: + twice, − once
const plus = page.locator('.counter button', { hasText: '+' });
await plus.click();
await plus.click();
await page.locator('.counter button', { hasText: '−' }).click();
await page.waitForTimeout(300);
s = await state();
ok(Object.values(s.entities).find((e) => e.kind === 'counter').state.value === 1, 'counter at 1 after +,+,−');

// scoreboard: my row +
await page.locator('.board .row button', { hasText: '+' }).first().click();
await page.waitForTimeout(300);
s = await state();
ok(
  Object.values(s.entities).find((e) => e.kind === 'scoreboard').state.values['p_tester'] === 1,
  'scoreboard row incremented',
);

// timer: start, wait, pause
await page.locator('.timer button').first().click();
await page.waitForTimeout(1200);
await page.locator('.timer button').first().click();
await page.waitForTimeout(300);
s = await state();
const timer = Object.values(s.entities).find((e) => e.kind === 'timer');
ok(!timer.state.running && timer.state.elapsedMs >= 1000, `timer paused at ${timer.state.elapsedMs}ms`);

// chips: split via context menu ("Take 1"), then merge back by dragging
await page.click('.token', { button: 'right' });
await page.click('.menu button:has-text("Take 1")');
await page.waitForTimeout(300);
s = await state();
let stacks = Object.values(s.entities).filter((e) => e.kind === 'token');
ok(stacks.length === 2 && stacks.map((t) => t.state.count).sort((a, b) => a - b).join() === '1,19', 'took 1 chip off the stack');

const small = stacks.find((t) => t.state.count === 1);
const big = stacks.find((t) => t.state.count === 19);
const toScreen = (e) => ({ x: e.pos.x + 17, y: e.pos.y + 17 + 44 }); // +size/2, +toolbar (view untransformed)
const a = toScreen(small);
const b = toScreen(big);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
s = await state();
stacks = Object.values(s.entities).filter((e) => e.kind === 'token');
ok(stacks.length === 1 && stacks[0].state.count === 20, 'dragging chip onto stack merged back to 20');

// zone auto-face-down: drag a card from the deck edge... simpler: draw to table face up, then drag into zone
const deckEl = await page.locator('[data-drop^="deck:"]').boundingBox();
await page.click('[data-drop^="deck:"]', { button: 'right' });
await page.click('.menu button:has-text("Draw face up")');
await page.waitForTimeout(300);
s = await state();
let card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === true, 'drew a card face up beside the deck');

const zone = Object.values(s.entities).find((e) => e.kind === 'zone');
const cardAt = { x: card.pos.x + 36, y: card.pos.y + 50 + 44 };
const zoneCenter = { x: zone.pos.x + zone.config.w / 2, y: zone.pos.y + zone.config.h / 2 + 44 };
await page.mouse.move(cardAt.x, cardAt.y);
await page.mouse.down();
await page.mouse.move(zoneCenter.x, zoneCenter.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === false, 'card flipped face down on entering the zone');

// ...and moving it within the zone must NOT re-flip after a manual flip up
const cardNow = { x: card.pos.x + 36, y: card.pos.y + 50 + 44 };
await page.mouse.dblclick(cardNow.x, cardNow.y);
await page.waitForTimeout(200);
await page.mouse.move(cardNow.x, cardNow.y);
await page.mouse.down();
await page.mouse.move(cardNow.x + 40, cardNow.y + 20, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(300);
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === true, 'moving within the zone does not re-flip the card');

await browser.close();
console.log('DONE');
