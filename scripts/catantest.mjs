// Catan template + arbitrary-positioning integration test.
import { chromium } from 'playwright-core';

const TOOLBAR = 44;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
const settle = () => page.waitForTimeout(700);

await page.goto('http://localhost:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.fill('input[placeholder="e.g. Beth"]', 'Cat');
await page.click('.tmpl:has-text("Catan")');
await page.click('button.primary:has-text("Start a new table")');
await page.waitForSelector('.viewport');
await settle();

const room = await page.evaluate(() => location.hash.replace('#/t/', ''));
const state = () => page.evaluate((r) => JSON.parse(localStorage.getItem(`ludwig:table:${r}`)), room);

let s = await state();
const board = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.placement.type === 'slots',
);
ok(board.config.placement.slots.length === 145, `board has 145 slots (got ${board.config.placement.slots.length})`);
const tiles = Object.values(s.entities).filter(
  (e) => e.kind === 'token' && (e.config.tags ?? []).includes('tile'),
);
ok(tiles.length === 19, `19 hex tiles placed (got ${tiles.length})`);

// pull one road off the red reserve and drop it near an edge slot
const reserve = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.label === 'Red pieces',
);
const roadStack = Object.values(s.entities).find(
  (e) => e.kind === 'token' && e.parent === reserve.id && (e.config.tags ?? []).includes('road'),
);
const stackScreen = {
  x: reserve.pos.x + roadStack.pos.x + 18,
  y: reserve.pos.y + roadStack.pos.y + 5 + TOOLBAR,
};
const edge = board.config.placement.slots.find((sl) => sl.accepts?.includes('road') && sl.rot !== 0);
const edgeScreen = { x: board.pos.x + edge.x, y: board.pos.y + edge.y + TOOLBAR };
await page.mouse.move(stackScreen.x, stackScreen.y);
await page.mouse.down();
await page.mouse.move(edgeScreen.x, edgeScreen.y, { steps: 8 });
await page.mouse.up();
await settle();
s = await state();
const placedRoad = Object.values(s.entities).find(
  (e) =>
    e.kind === 'token' &&
    e.parent === board.id &&
    (e.config.tags ?? []).includes('road') &&
    e.state.count === 1,
);
const stackAfter = Object.values(s.entities).find((e) => e.id === roadStack.id);
ok(!!placedRoad, 'dragging the road stack pulled ONE road onto the board');
ok(stackAfter.state.count === 14, `reserve stack down to 14 (got ${stackAfter.state.count})`);
// bar tokens render 0.3× as tall as wide — the snap centers on that shape
const rhw = placedRoad.config.size / 2;
const rhh = Math.round(placedRoad.config.size * 0.3) / 2;
const onEdge = board.config.placement.slots.some(
  (sl) =>
    sl.accepts?.includes('road') &&
    Math.abs(sl.x - (placedRoad.pos.x + rhw)) < 1 &&
    Math.abs(sl.y - (placedRoad.pos.y + rhh)) < 1 &&
    (sl.rot ?? 0) === placedRoad.pos.rot,
);
ok(onEdge, `road snapped to an edge slot with rotation ${placedRoad.pos.rot}°`);

// settlement: pull one onto a vertex — must NOT land on an edge/hex slot
const setStack = Object.values(s.entities).find(
  (e) =>
    e.kind === 'token' &&
    e.parent === reserve.id &&
    (e.config.tags ?? []).includes('building') &&
    e.state.count === 5,
);
const vertex = board.config.placement.slots.find((sl) => sl.accepts?.includes('building'));
await page.mouse.move(reserve.pos.x + setStack.pos.x + 11, reserve.pos.y + setStack.pos.y + 11 + TOOLBAR);
await page.mouse.down();
await page.mouse.move(board.pos.x + vertex.x + 6, board.pos.y + vertex.y - 8 + TOOLBAR, { steps: 8 });
await page.mouse.up();
await settle();
s = await state();
const placedSet = Object.values(s.entities).find(
  (e) =>
    e.kind === 'token' &&
    e.parent === board.id &&
    (e.config.tags ?? []).includes('building') &&
    e.state.count === 1,
);
const shalf = placedSet.config.size / 2;
const onVertex = board.config.placement.slots.some(
  (sl) =>
    sl.accepts?.includes('building') &&
    Math.abs(sl.x - (placedSet.pos.x + shalf)) < 1 &&
    Math.abs(sl.y - (placedSet.pos.y + shalf)) < 1,
);
ok(onVertex, 'settlement snapped to a vertex slot (accepts filter)');

// robber moves hex-to-hex (it's the only unlocked chit)
const robber = Object.values(s.entities).find(
  (e) => e.kind === 'token' && e.config.label === '☠',
);
const hexSlot = board.config.placement.slots.find(
  (sl) => sl.accepts?.includes('chit') && Math.abs(sl.x - (robber.pos.x + 15)) > 100,
);
await page.mouse.move(board.pos.x + robber.pos.x + 15, board.pos.y + robber.pos.y + 15 + TOOLBAR);
await page.mouse.down();
await page.mouse.move(board.pos.x + hexSlot.x, board.pos.y + hexSlot.y + TOOLBAR, { steps: 6 });
await page.mouse.up();
await settle();
s = await state();
const robberAfter = Object.values(s.entities).find((e) => e.id === robber.id);
ok(
  Math.abs(hexSlot.x - (robberAfter.pos.x + 15)) < 1 && Math.abs(hexSlot.y - (robberAfter.pos.y + 15)) < 1,
  'robber snapped onto another hex',
);

// ---- arbitrary positioning: shared pos must not change on local moves ----
const scoreboard = Object.values(s.entities).find((e) => e.kind === 'scoreboard');
await page.mouse.click(scoreboard.pos.x + 60, scoreboard.pos.y + 8 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("my view only")');
await settle();
s = await state();
const sb = Object.values(s.entities).find((e) => e.kind === 'scoreboard');
ok(sb.positioning === 'arbitrary', 'scoreboard switched to arbitrary positioning');

// drop on empty felt (left of the reserves) so this is a pure reposition,
// not a containment change (which is shared by design)
const sharedBefore = { x: sb.pos.x, y: sb.pos.y };
const dropAt = { x: sb.pos.x - 30, y: sb.pos.y + 560 }; // clear of the setup note
await page.mouse.move(sb.pos.x + 60, sb.pos.y + 8 + TOOLBAR);
await page.mouse.down();
await page.mouse.move(dropAt.x + 60, dropAt.y + 8 + TOOLBAR, { steps: 6 });
await page.mouse.up();
await settle();
s = await state();
const sbAfter = Object.values(s.entities).find((e) => e.kind === 'scoreboard');
ok(
  sbAfter.pos.x === sharedBefore.x && sbAfter.pos.y === sharedBefore.y,
  'dragging an arbitrary item left the SHARED pos untouched',
);
const override = await page.evaluate(
  (r) => JSON.parse(localStorage.getItem(`ludwig:pos:${r}`) ?? '{}'),
  room,
);
const ov = override[sbAfter.id];
ok(
  ov && Math.abs(ov.x - dropAt.x) < 10 && Math.abs(ov.y - dropAt.y) < 10,
  `local override stored (${ov ? Math.round(ov.x) : '—'},${ov ? Math.round(ov.y) : '—'} vs shared ${sharedBefore.x},${sharedBefore.y})`,
);

// switching back to shared adopts my placement for everyone
await page.mouse.click(ov.x + 60, ov.y + 20 + TOOLBAR, { button: 'right' });
await page.click('.menu button:has-text("my view only → shared")');
await settle();
s = await state();
const sbShared = Object.values(s.entities).find((e) => e.kind === 'scoreboard');
ok(
  sbShared.positioning === 'absolute' && Math.abs(sbShared.pos.x - ov.x) < 1,
  'switching back to shared adopted my placement',
);

await browser.close();
console.log('DONE');
