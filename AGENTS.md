# AGENTS.md — workflow for AI agents working on ludwig

Context doc for any agent/model session. Keep this file up to date whenever the
deploy or test workflow changes — it replaces per-prompt instructions.

## Project shape

- Svelte 5 + Vite + TypeScript, no backend (static files, WebRTC via Trystero).
- Read first: [PROPOSAL.md](PROPOSAL.md), [PLAN.md](PLAN.md) (milestones),
  [SPEC.md](SPEC.md), [README.md](README.md), [TEMPLATES.md](TEMPLATES.md).
- Standing design principles (non-negotiable):
  - Kinds are rendering primitives; **behavior is configuration**.
  - No chrome-only objects.
  - Every gesture needs a visible affordance.
- Rejected ideas — do not revisit: server-side secret-state stripping (ludwig is
  honor-system + serverless by design, SPEC §4), ECS/trait refactor (config
  flags already serve this), nested state (state is flat + LWW).

## Remotes & deploy

- `origin` = https://github.com/bdnorg/ludwig-F.git — **private mirror**.
- `public` = https://github.com/bdnorg/ludwig.git — GitHub Pages deploys
  https://bdnorg.github.io/ludwig/ on push to `main`.
- **Push BOTH remotes after each milestone**: `git push origin main && git push public main`.
- Watch the Pages deploy: `gh run list --repo bdnorg/ludwig` (poll until complete).

## Verification (run all before calling a milestone done)

```sh
npm test                     # vitest unit tests
npm run check                # svelte-check + tsc
npm run dev -- --port 5173 --strictPort   # dev server for integration suites
node scripts/m4test.mjs      # core interactions
node scripts/cards52test.mjs
node scripts/dominiontest.mjs
node scripts/catantest.mjs
node scripts/p2ptest.mjs     # 2-browser P2P sync
```

- A leftover dev server on port 5173 serving this folder is fine — **reuse it**,
  don't kill/restart. But verify it actually serves this repo first: if it
  404s, it's a zombie from a deleted checkout — kill it and start fresh.
- Update the integration suites in `scripts/` whenever behavior changes; a
  milestone isn't done until they pass against the new behavior.

### Playwright quirks

- Store autosave debounce is **400ms** — suites must settle ~700ms before
  reading localStorage.
- Since M17 every mat/pile has ONE move handle, bottom-center: tests use
  `.h-s`. Stacking/merging requires dropping on the **bullseye** at the
  target's top-right — see `dropOnBullseye()` in m4test.mjs. Token piles are
  implicit stack MATS (`config.implicit`); finders matching "any stack mat"
  must exclude implicit ones.
- Prefer element locators over raw coordinates near mat corners.
- Keep the shift-pan test **last** in a suite.
- Do NOT verify with the Claude Preview panel — it reports a zero-size
  viewport. Use the Playwright scripts / real Chrome.
- The dependency is `playwright-core` with `channel: 'chrome'` (no bundled
  browsers) — throwaway scripts must import it the same way, from inside
  the repo so node resolves it.

## Roadmap & handoff status

Open work, ranked by impact. Tag says who can do it: **design** = prefer
Fable/top model; **mechanical** = safe for Sonnet/Opus. Update as work lands;
landed milestones get one line (details live in PROPOSAL.md + git log).

- [ ] **Deploy the last three milestones** (mechanical, do first): the public
      mirror is 18 commits behind — M19–M21 never reached
      https://bdnorg.github.io/ludwig/. This checkout has no `public` remote
      configured (`git remote add public https://github.com/bdnorg/ludwig.git`),
      then push + live smoke test per the wrap-up checklist.
- [ ] **M22 placeable mat buttons** (design; approved — PROPOSAL v5 "Still
      open"): design the placement model first (anchor points vs free x/y),
      then drag UX and gamebox syntax. Queued alongside: `showSum` list form
      (`['coin','vp']` → row of Σ badges), inspector touch gesture
      (long-press?).
- [ ] **Playtest v5 with real people** (user + any model): seat kits,
      autoReshuffle, tray drag, color pick, attribution flashes all shipped
      untested by human hands — every v5 decision traces to one Dominion
      playtest in early August. Feedback here should steer M23+.
- [ ] **Permanent integration suite for the lobby gamebox flow** (mechanical):
      upload a manifest, download one, both upload error paths — structural
      failure and relative-asset rejection. Verified only by throwaway
      scripts when the lobby landed; nothing guards them now. Precondition
      for retiring the code templates.
- [ ] **Retire the code templates** (mechanical; unblocked once the suite
      above exists): delete cards52.ts/dominion.ts/catan.ts + TEMPLATES
      entries in ONE commit, converting the "matches today's table" tests to
      literal expectations (counts, labels, face sets) in the same commit —
      the code reference disappears with the code. dominiontest/catantest
      already exercise the gamebox path since the gallery prefers boxes.
- [ ] **Turn keeper, in practice** (mechanical build, design judgment on
      feel): decision is PURE CONFIG — marker token + macro cycling it
      through a `groups: ['seats']` mat group in label order. Build it into
      a real box (euchre or a new one) and playtest; only add a primitive if
      the macro feels bad.
- [ ] **Wordlist→cards loader** (mechanical, OK to build without asking):
      gamebox cardset variant `{ type: 'cardset', wordsAsset: '<asset id>' }`
      — newline-separated wordlist fetched at load, each word becomes a
      title-only card.
- [ ] **Author new pure-config gameboxes** (mechanical), one per session:
      cribbage, chess, go (infinite stone supplies — `supply: 'infinite'`
      exists; 361 stones will also stress-test rendering), Scrabble, Texas
      Hold'em, Pandemic, RoboRally, Codenames. Their real value is surfacing
      papercuts — log friction, don't silently work around it.
- [ ] **General-purpose gamebox** (design; after turn-keeper + wordlist).
- [ ] **Revisit the kind-dissolution watchlist** (design; PROPOSAL v4 §13 —
      counter/scoreboard/note/token-pile as configs). It was deferred "until
      after v4 playtesting", which has now happened.

**Landed:** M17 stacking & drag feel · M18 gamebox format + cards52/euchre
packages · M19 card-play UX (v5 round 1) · M20 inspector, join colors,
attribution (round 2) · M21 seat kits, autoReshuffle, tray (round 3) ·
Dominion + Catan converted to gamebox dirs · lobby gallery with
upload/download · reference-pages panel.

**Design calls already made — don't re-decide** (rationale in PLAN.md M18
notes and PROPOSAL.md):
- Blokus shaped/multi-cell tokens and a Pictionary sketch primitive are
  genuinely new primitives — ASK the user before building either.
- Codenames key mat: ship privacy 'nothing' with no owner; spymasters claim
  it via Mat settings → owners; that instruction goes in the box's setup
  note (a gamebox can't pre-assign owners — player ids are per-table).
- Uploaded gameboxes are a SINGLE manifest.json; assets must be absolute
  URLs or data: URIs (implemented — `assertPortableAssets`). Only built-in
  packages get relative paths, absolutized by the lobby fetcher.
- Custom slot boards (cribbage pegging track etc.): compute the slot list in
  genboxes.mjs and emit plain `slots` arrays — no new SlotGenerate kinds
  unless a board needs thousands. Same pattern as Catan's fixed layout,
  where genboxes.mjs duplicates hexGeometry() and the manifest stays plain
  coordinates.

**How to add a gamebox:** add a section to `scripts/genboxes.mjs` (or
hand-write `public/gameboxes/<dir>/manifest.json` + add it to index.json),
regenerate, and add a `gamebox.test.ts` case following the cards52 pattern.
Layout item types live in gamebox.ts (`LayoutItem`); mats are referenced by
label; token piles use `{ type: 'pile' }`; assets go in the manifest's
`assets` map and are referenced as `asset:<id>`.

## Milestone wrap-up checklist

1. All suites green (unit + check + every `scripts/*test.mjs`).
2. Update README/Help text if gestures or UI changed; update this file if the
   workflow changed.
3. Commit per milestone, message `M<N>: <summary>`, ending with:
   `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
4. Push both remotes.
5. After Pages deploys, live smoke test:
   `LUDWIG_URL=https://bdnorg.github.io/ludwig/ node scripts/p2ptest.mjs`
