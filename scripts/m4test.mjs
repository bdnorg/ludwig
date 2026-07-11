// M4 toolkit verification: dice, counter, scoreboard, timer, zones, chips.
// Reads state from localStorage autosave, which is debounced 400ms — always
// settle >600ms before asserting.
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
const find = (s, kind) => Object.values(s.entities).find((e) => e.kind === kind);
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);

async function drag(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** spawn from the palette, then drag the new entity's body to (tx, ty) */
async function spawnAt(label, kind, tx, ty, grab = { dx: 10, dy: 10 }) {
  await page.click('.toolbar button.primary');
  await page.click(`.menu button:has-text("${label}")`);
  await settle();
  const e = find(await state(), kind);
  await drag(
    { x: e.pos.x + grab.dx, y: e.pos.y + grab.dy + TOOLBAR },
    { x: tx + grab.dx, y: ty + grab.dy + TOOLBAR },
  );
  await settle();
  return find(await state(), kind);
}

// lay the toolkit out on a grid so nothing overlaps
const chip = await spawnAt('Chips $5', 'token', 150, 550, { dx: 17, dy: 17 });
const dice = await spawnAt('Two dice', 'dice', 350, 560, { dx: 20, dy: 20 });
await spawnAt('Counter', 'counter', 550, 550, { dx: 46, dy: 8 });
await spawnAt('Scoreboard', 'scoreboard', 800, 520, { dx: 60, dy: 8 });
await spawnAt('Timer', 'timer', 1050, 550, { dx: 60, dy: 12 });
const zone = await spawnAt('Face-down zone', 'zone', 750, 120, { dx: 40, dy: 8 });
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

// chips: split via context menu ("Take 1"), then merge back by dragging
await page.mouse.click(chip.pos.x + 17, chip.pos.y + 17 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Take 1")');
await settle();
s = await state();
let stacks = Object.values(s.entities).filter((e) => e.kind === 'token');
ok(
  stacks.length === 2 && stacks.map((t) => t.state.count).sort((a, b) => a - b).join() === '1,19',
  'took 1 chip off the stack',
);

const small = stacks.find((t) => t.state.count === 1);
const big = stacks.find((t) => t.state.count === 19);
await drag(
  { x: small.pos.x + 17, y: small.pos.y + 17 + TOOLBAR },
  { x: big.pos.x + 17, y: big.pos.y + 17 + TOOLBAR },
);
await settle();
s = await state();
stacks = Object.values(s.entities).filter((e) => e.kind === 'token');
ok(stacks.length === 1 && stacks[0].state.count === 20, 'dragging chip onto stack merged back to 20');

// zone auto-face-down: draw a card face up, then drag it into the zone
await page.mouse.click(deck.pos.x + 36, deck.pos.y + 50 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("Draw face up")');
await settle();
s = await state();
let card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === true, 'drew a card face up beside the deck');

const zc = { x: zone.pos.x + zone.config.w / 2, y: zone.pos.y + zone.config.h / 2 + TOOLBAR };
await drag({ x: card.pos.x + 36, y: card.pos.y + 50 + TOOLBAR }, zc);
await settle();
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === false, 'card flipped face down on entering the zone');

// ...and moving it within the zone must NOT re-flip after a manual flip up
let at = { x: card.pos.x + 36, y: card.pos.y + 50 + TOOLBAR };
await page.mouse.dblclick(at.x, at.y);
await settle();
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === true, 'double-click flipped it back up inside the zone');
at = { x: card.pos.x + 36, y: card.pos.y + 50 + TOOLBAR };
await drag(at, { x: at.x + 40, y: at.y + 20 });
await settle();
s = await state();
card = Object.values(s.entities).find((e) => e.kind === 'card' && e.parent === null);
ok(card.state.faceUp === true, 'moving within the zone does not re-flip the card');

await browser.close();
console.log('DONE');
