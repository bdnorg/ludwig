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
  don't kill/restart.
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

## Roadmap & handoff status

Work is ordered so design/judgment/foundation tasks (needing a top-tier model)
come first, and mechanical tasks (fine for Sonnet/Opus) are postponed. Update
the checkboxes as work lands.

**Design-heavy — prefer Fable/top model:**
- [x] M17 stacking & drag feel — DONE (committed): single bottom-center handle,
      hover-scoped handles (hover-self tracking in EntityView), visible
      under-piece, real token ghosts (TokenView.svelte), token piles dissolved
      into implicit stack mats (ops.tokenPile/stackOnto/mergeStacks/splitPile +
      persist migrate), bullseye drop replacing merge-on-overlap.
- [ ] M18 foundation: gamebox package format (manifest.json with asset
      registry, layout, reference pages), loader/validator reusing the
      pending-import path in templates.ts, convert **cards52** as the exemplar,
      unit-test pattern asserting loaded boxes match today's tables.
- [ ] Design calls flagged in PLAN.md M18: Blokus shaped-token primitive,
      Pictionary sketch primitive (ASK before building), turn-keeper-as-config,
      wordlist→cards loader feature, Codenames per-role visibility.

**Mechanical — safe for Sonnet/Opus once the above exists:**
- [ ] Convert remaining built-ins to gamebox dirs (Dominion, Catan, Euchre),
      following the cards52 exemplar; keep match-today's-tables tests green.
- [ ] Author new pure-config gameboxes: cribbage, chess, go, Scrabble, Texas
      Hold'em, Pandemic, RoboRally, Codenames (one per session/task).
- [ ] General-purpose gamebox assembly (once turn keeper + wordlist designs are
      settled).
- [ ] Lobby: list built-ins from site, upload-a-gamebox, download-any-box.

## Milestone wrap-up checklist

1. All suites green (unit + check + every `scripts/*test.mjs`).
2. Update README/Help text if gestures or UI changed; update this file if the
   workflow changed.
3. Commit per milestone, message `M<N>: <summary>`, ending with:
   `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
4. Push both remotes.
5. After Pages deploys, live smoke test:
   `LUDWIG_URL=https://bdnorg.github.io/ludwig/ node scripts/p2ptest.mjs`
