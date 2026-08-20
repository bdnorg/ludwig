// Two-peer P2P sync test: two isolated Chrome contexts join the same ludwig
// room over real Nostr relays and we assert state converges.
// Set LUDWIG_URL to smoke-test a deployed site, e.g.
//   LUDWIG_URL=https://bdnorg.github.io/ludwig/ node scripts/p2ptest.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.LUDWIG_URL ?? 'http://localhost:5173/';
const ROOM = 'test-p2p-' + Math.random().toString(36).slice(2, 8);
const URL = `${BASE}#/t/${ROOM}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function makePeer(name, color = '#3d9be4') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name} console.error]`, m.text());
  });
  await page.goto(BASE);
  await page.evaluate(
    ([n, c]) => {
      localStorage.setItem(
        'ludwig:player',
        JSON.stringify({ id: 'p_' + n, name: n, color: c }),
      );
    },
    [name, color],
  );
  await page.goto(URL);
  await page.waitForSelector('.viewport');
  return page;
}

const alice = await makePeer('alice');
const bob = await makePeer('bob', '#e4573d'); // distinct color: attribution is asserted below

// wait for the mesh: each roster should show 2 players
const rosterCount = (p) => p.evaluate(() => document.querySelectorAll('.roster .player').length);
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  const [a, b] = await Promise.all([rosterCount(alice), rosterCount(bob)]);
  if (a === 2 && b === 2) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const [a, b] = await Promise.all([rosterCount(alice), rosterCount(bob)]);
if (a !== 2 || b !== 2) {
  console.log(`FAIL: peers never met (alice sees ${a}, bob sees ${b})`);
  await browser.close();
  process.exit(1);
}
console.log('PASS: peers connected, rosters show both players');

// alice spawns a 52-card deck; bob should see it
await alice.click('.toolbar button.primary');
await alice.click('.menu button:has-text("52-card deck")');
await bob.waitForSelector('[data-drop^="mat:mat_"]', { timeout: 15000 });
console.log('PASS: deck created by alice appeared for bob');

// bob draws two cards by double-clicking the deck; check counts on both sides.
// M20 attribution: the moment bob's commit lands, alice's view flashes the
// touched entities in bob's color — arm the wait BEFORE bob acts (2s lifetime)
const flashPromise = alice.waitForSelector('.flashring', { timeout: 20000 });
await bob.dblclick('[data-drop^="mat:mat_"]');
let flashStyle = null;
try {
  const flashEl = await flashPromise;
  flashStyle = (await flashEl.getAttribute('style')) ?? '';
} catch {
  /* no flash appeared */
}
console.log(
  flashStyle !== null
    ? "PASS: bob's change flashed on alice's view (.flashring)"
    : 'FAIL: no .flashring appeared for alice after bob drew',
);
console.log(
  flashStyle !== null && flashStyle.includes('#e4573d')
    ? "PASS: flash ring carries bob's color"
    : `FAIL: flash ring style lacks bob's color (${flashStyle})`,
);
await bob.dblclick('[data-drop^="mat:mat_"]');
await alice.waitForFunction(
  () => document.querySelector('[data-drop^="mat:mat_"] .count')?.textContent === '50',
  { timeout: 15000 },
);
const bobTray = await bob.evaluate(() => document.querySelectorAll('.tray .slot').length);
const aliceSeesBobHand = await alice.evaluate(
  () => [...document.querySelectorAll('.roster .player')].map((p) => p.textContent).join(' '),
);
console.log(`PASS: bob drew 2 (tray=${bobTray}); alice sees deck=50, roster: ${aliceSeesBobHand.trim()}`);

// hidden info: alice must NOT see bob's card faces anywhere in her DOM/state
const aliceHandCards = await alice.evaluate(() => {
  const s = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ludwig:table:test-p2p'))));
  const hand = Object.values(s.entities).find((e) => e.kind === 'mat' && e.config.ownerId === 'p_bob');
  return hand ? hand.state.order.length : -1;
});
console.log(`INFO: honor-system — alice's state does hold bob's ${aliceHandCards} card ids (expected; renderer hides faces)`);
const aliceTray = await alice.evaluate(() => document.querySelectorAll('.tray .slot').length);
console.log(aliceTray === 0 ? 'PASS: alice tray shows none of bob\'s cards' : `FAIL: alice tray has ${aliceTray}`);

// M20: cursor trails — while bob's pointer sweeps the felt, alice renders
// fading .dot trail elements behind his cursor (roster dots are spans; the
// trail is a div, so match the tag)
let sweeping = true;
const sweep = (async () => {
  for (let i = 0; i < 120 && sweeping; i++) {
    await bob.mouse.move(200 + (i % 20) * 40, 350 + (i % 7) * 30, { steps: 2 });
    await new Promise((r) => setTimeout(r, 50));
  }
})();
let dotSeen = true;
try {
  await alice.waitForSelector('div.dot', { timeout: 15000 });
} catch {
  dotSeen = false;
}
sweeping = false;
await sweep;
console.log(
  dotSeen
    ? "PASS: bob's cursor left a fading trail of dots on alice's felt"
    : 'FAIL: no cursor-trail dots rendered for alice',
);

// M11: bob's hand is an ordinary on-table mat for alice — visible, backs only
const bobHandForAlice = await alice.evaluate(() => {
  const el = document.querySelector('[data-entity-id="hand_p_bob"]');
  return el ? { fronts: el.querySelectorAll('.face.front').length } : null;
});
console.log(
  bobHandForAlice && bobHandForAlice.fronts === 0
    ? "PASS: alice sees bob's hand on the table (backs only)"
    : `FAIL: bob's hand for alice: ${JSON.stringify(bobHandForAlice)}`,
);

// late joiner: carol arrives and should receive the full table via snapshot
const carol = await makePeer('carol');
await carol.waitForSelector('[data-drop^="mat:mat_"]', { timeout: 30000 });
const carolDeck = await carol.evaluate(() => document.querySelector('[data-drop^="mat:mat_"] .count')?.textContent);
console.log(carolDeck === '50' ? 'PASS: late joiner carol got snapshot (deck=50)' : `FAIL: carol deck=${carolDeck}`);

// ---- M21 seat kits over P2P: dana starts a Dominion table (auto-claims
// seat 1); eve joins and must end up owning the seat-2 kit (Deck 2 +
// Discard 2), with the claim visible on both sides.
const ROOM2 = 'test-seat-' + Math.random().toString(36).slice(2, 8);
const URL2 = `${BASE}#/t/${ROOM2}`;

async function makeSeatPeer(name, color, pending = null) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name} console.error]`, m.text());
  });
  await page.goto(BASE);
  await page.evaluate(
    ([n, c, tmpl]) => {
      localStorage.setItem(
        'ludwig:player',
        JSON.stringify({ id: 'p_' + n, name: n, color: c }),
      );
      if (tmpl) sessionStorage.setItem('ludwig:pending-template', tmpl);
    },
    [name, color, pending],
  );
  await page.goto(URL2);
  await page.waitForSelector('.viewport');
  return page;
}

const seatState = (p) =>
  p.evaluate((r) => JSON.parse(localStorage.getItem(`ludwig:table:${r}`) ?? 'null'), ROOM2);
const kitOwner = (s, label) =>
  Object.values(s?.entities ?? {}).find((e) => e.kind === 'mat' && e.config.label === label)
    ?.config.ownerId;

const dana = await makeSeatPeer('dana', '#48b265', 'dominion');
// creator claims seat 1 locally at table start (poll: autosave is debounced)
let sd = null;
for (let i = 0; i < 20 && !sd; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const st = await seatState(dana);
  if (st && kitOwner(st, 'Deck 1')) sd = st;
}
console.log(
  sd && kitOwner(sd, 'Deck 1') === 'p_dana' && kitOwner(sd, 'Discard 1') === 'p_dana'
    ? 'PASS: dana (creator) auto-claimed seat 1'
    : `FAIL: dana's seat 1 claim missing (deck=${kitOwner(sd, 'Deck 1')})`,
);

// eve joins: the snapshot carries the kits; her autoSeat must claim seat 2
const eve = await makeSeatPeer('eve', '#9b59c9');
const seatDeadline = Date.now() + 90000;
let se = null;
while (Date.now() < seatDeadline) {
  const st = await seatState(eve);
  if (st && kitOwner(st, 'Deck 2') === 'p_eve') {
    se = st;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(
  se && kitOwner(se, 'Deck 2') === 'p_eve' && kitOwner(se, 'Discard 2') === 'p_eve'
    ? 'PASS: eve (second joiner) auto-claimed seat 2 (Deck 2 + Discard 2)'
    : `FAIL: eve never claimed seat 2 (deck2=${se ? kitOwner(se, 'Deck 2') : 'no state'})`,
);
console.log(
  se && Object.values(se.log ?? {}).some((e) => e.text.includes('eve took seat 2'))
    ? "PASS: eve's seat claim was logged"
    : 'FAIL: no "eve took seat 2" log entry',
);

// eve's kit renders the owner-colored dot and her name on the label
const eveDeckLabel = await eve.evaluate(() => {
  const labels = [...document.querySelectorAll('.entity .label')];
  const el = labels.find((l) => l.textContent.includes('Deck 2'));
  return el ? { text: el.textContent.trim(), odot: !!el.querySelector('.odot') } : null;
});
console.log(
  eveDeckLabel?.text === 'eve · Deck 2' && eveDeckLabel.odot
    ? 'PASS: eve\'s Deck 2 label wears her name and color dot'
    : `FAIL: eve's Deck 2 label: ${JSON.stringify(eveDeckLabel)}`,
);

// ...and the claim syncs back to dana
const backDeadline = Date.now() + 30000;
let danaSees = null;
while (Date.now() < backDeadline) {
  const st = await seatState(dana);
  if (st && kitOwner(st, 'Deck 2') === 'p_eve') {
    danaSees = st;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(
  danaSees
    ? "PASS: eve's seat-2 claim synced to dana"
    : "FAIL: dana never saw eve's seat-2 claim",
);

await browser.close();
console.log('DONE');
