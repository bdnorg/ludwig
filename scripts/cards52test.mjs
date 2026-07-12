// M12 integration test: 52-card template macros (quick-action strip +
// palette), help page, and the lobby import-template flow.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
const settle = () => page.waitForTimeout(700);

// through the lobby: name, pick the 52-card template, start
await page.goto('http://localhost:5173/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.fill('input[placeholder="e.g. Beth"]', 'Mac');
await page.click('.tmpl:has-text("52-card deck")');
await page.click('button.primary:has-text("Start a new table")');
await page.waitForSelector('.viewport');
await settle();

const room = await page.evaluate(() => location.hash.replace('#/t/', ''));
const state = () => page.evaluate((r) => JSON.parse(localStorage.getItem(`ludwig:table:${r}`)), room);

// the template put macros on the root mat → quick-action strip renders
let s = await state();
ok(
  (s.entities['mat_table']?.config.macros ?? []).length === 2,
  'root mat carries the template macros',
);
const stripLabels = await page.$$eval('.quickbar button', (els) => els.map((b) => b.textContent.trim()));
ok(
  stripLabels.some((l) => l.includes('Deal 5')) && stripLabels.some((l) => l.includes('Gather')),
  `quick-action strip shows: ${stripLabels.join(' | ')}`,
);

// deal 5 to hands (only me connected → my hand gets 5)
await page.click('.quickbar button:has-text("Deal 5")');
await settle();
s = await state();
const hand = Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.ownerId);
const deck = Object.values(s.entities).find(
  (e) => e.kind === 'mat' && e.config.placement.type === 'stack',
);
ok(
  Object.values(s.entities).filter((e) => e.parent === hand.id).length === 5,
  'macro dealt 5 to my hand',
);
ok(deck.state.order.length === 47, `deck down to 47 (got ${deck.state.order.length})`);

// undo reverses the whole macro as one batch
await page.click('.toolbar button:has-text("undo")');
await settle();
s = await state();
ok(
  Object.values(s.entities).filter((e) => e.parent === hand.id).length === 0 &&
    Object.values(s.entities).find((e) => e.id === deck.id).state.order.length === 52,
  'undo reversed the whole deal in one step',
);

// deal again, drop one card loose, then Gather & shuffle brings all 52 home
await page.click('.quickbar button:has-text("Deal 5")');
await settle();
await page.click('.quickbar button:has-text("Gather")');
await settle();
s = await state();
ok(
  Object.values(s.entities).find((e) => e.id === deck.id).state.order.length === 52 &&
    Object.values(s.entities).filter((e) => e.parent === hand.id).length === 0,
  'gather & shuffle returned all 52 cards to the deck',
);
const logTexts = Object.values(s.log ?? {}).map((e) => e.text);
ok(
  logTexts.some((t) => t.includes('ran') && t.includes('Gather')),
  `macro run logged: "${logTexts.find((t) => t.includes('ran')) ?? ''}"`,
);

// macros ride the command palette even with nothing selected
await page.mouse.move(400, 200);
await page.keyboard.press(' ');
await page.waitForTimeout(300);
const paletteHasMacro = await page.evaluate(() =>
  [...document.querySelectorAll('.palette .list button span')].some((b) =>
    b.textContent.includes('Deal 5'),
  ),
);
ok(paletteHasMacro, 'palette offers the macro without a selection');
await page.keyboard.press('Escape');

// help page
await page.goto('http://localhost:5173/#/help');
await page.waitForSelector('.help');
const helpText = await page.evaluate(() => document.querySelector('.help h1')?.textContent);
ok(helpText === 'how ludwig works', 'help page renders');
await page.click('.help a.back');
await page.waitForSelector('.lobby');
ok(true, 'help links back to the lobby');

// lobby import-template: export this table's state to a file, import it
s = await state();
const file = join(tmpdir(), `ludwig-template-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(s));
await page.setInputFiles('.gallery input[type="file"]', file);
await page.waitForSelector('.viewport');
await settle();
const room2 = await page.evaluate(() => location.hash.replace('#/t/', ''));
ok(room2 !== room, `import started a fresh room (${room2})`);
const s2 = await page.evaluate((r) => JSON.parse(localStorage.getItem(`ludwig:table:${r}`)), room2);
const deck2 = Object.values(s2.entities).find(
  (e) => e.kind === 'mat' && e.config.placement.type === 'stack',
);
ok(deck2 && deck2.state.order.length === 52, 'imported template rebuilt the 52-card deck');
ok(
  (s2.entities['mat_table']?.config.macros ?? []).length === 2,
  'imported template kept its macros',
);

await browser.close();
console.log('DONE');
