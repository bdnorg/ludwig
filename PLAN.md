# Ludwig — Implementation Plan

Six milestones. Each ends in something runnable and demoable; networking
arrives early (M2) because P2P sync is the highest-risk piece and everything
after it should be built against the real thing.

## M1 — Scaffold & local table (no networking)
- Vite + Svelte + TypeScript project; ESLint/Prettier; Vitest.
- Entity model as typed TS (`Entity`, kind-specific config/state) mirroring SPEC §2–3.
- In-memory store (Svelte stores) + pure reducer functions for every mutation
  (`applyUpdate`, `applyOp`) — the same functions the network layer will call in M2.
- Pan/zoom table surface; spawn/drag/flip/lock tokens and notes; z-order.
- Autosave to `localStorage`; export/import JSON.

**Demo:** single browser, drag tokens and sticky notes around a table; refresh
and the table is still there.

## M2 — Networking
- Trystero integration (default: torrent-tracker strategy); room codes; lobby
  screen; join link `#/t/<code>`.
- Message protocol from SPEC §5: create/update/delete with Lamport LWW,
  `op` transactions, ephemeral drag + pointer streams, join/snapshot flow,
  host-role handoff.
- Roster panel, player colors, remote cursors.
- Unit tests: version comparison, concurrent-update convergence (two actors,
  same entity), snapshot merge for a rejoining peer.

**Demo:** two browsers on different machines drag the same tokens; a third
joins late and receives the full table.

## M3 — Cards, decks, hands
- Card/Deck/Hand entities and rendering (fronts as text/SVG; standard-deck art
  generated, not image assets).
- Ops: shuffle (crypto RNG), draw to hand / draw to table, deal N to each
  player, cut, flip-top, return-to-deck (top/bottom/shuffle-in), search/spread.
- Hand tray UI; drag between tray, table, and decks; face-up/face-down play;
  reveal-hand-to (player / all).
- Visibility rendering per SPEC §4; deck shows count + top-card back/face per
  `facePolicy`.
- Built-in **standard 52-card** template (jokers toggle).

**Demo:** deal a hand of five to each player; play cards face down; flip them.

## M4 — Sandbox toolkit
- Dice (config sides/count, roll animation, broadcast results).
- Counter + per-player scoreboard; timer (countdown/stopwatch).
- Zones: create/resize/label; auto-face-down behavior; per-player tint.
- Chip tokens with denominations (for poker); token stacks with count badge.
- Spawn palette tying it all together; context menus finalized.

**Demo:** a full poker table assembled from the palette in under a minute.

## M5 — Playtest hardening (acceptance: SPEC §8)
- Play poker, hearts, and euchre with 3–4 real people; log every point of
  friction; fix the interaction papercuts this always surfaces (mis-drops,
  z-fighting, fat-finger flips, undo).
- Undo (local, last-own-action) — decide scope based on playtest pain.
- Reconnect robustness: refresh mid-game, host departure, full-table restore
  from `localStorage`.
- Deploy as static site (GitHub Pages); README with "start a game" walkthrough.

**Exit criteria:** three browsers on three networks complete a hand of euchre
with score kept on the scoreboard, no restarts required.

## M6 — Templates & custom decks (post-v1, first extension)
- Template format docs; "save as template" (reset state, keep config).
- Custom card sets from JSON (text-based cards first — enough for Dominion-style
  play), then image URLs.
- Template gallery page.

## Risks & mitigations
| Risk | Mitigation |
|------|------------|
| WebRTC connectivity (symmetric NAT) fails for some player pairs | Trystero supports multiple strategies; document TURN as a config option; test early in M2 on real networks |
| Public torrent trackers flaky for signaling | Trystero lets us list several trackers; swappable for self-hosted signaling later without app changes |
| Concurrent-edit divergence between peers | All mutations through pure reducers + LWW tested in M2 before any card logic exists |
| Drag/drop feel is bad → platform feels bad | Cards/tokens as DOM nodes with CSS transforms; playtest milestone dedicated to feel (M5) |

---

# v2 milestones (Mats → Actions → Gamebox)

Decisions locked with the user (2026-07): clean refactor (deck/hand/zone →
Mat, old saves discarded); full-spectrum visibility (faces/count/existence,
advanced knobs folded away for players); sequencing mats → actions →
gamebox; keyboard v1 = palette + core verbs + auto mat letters.

## M7 — Mats (SPEC §10–11)
- `mat` kind: placement (free/grid/slots/stack/fan), faceDefault,
  visibility {faces, count, existence}, ownerId, image, nesting.
- Refactor: deck/hand/zone/chip-stack become mat configs; ops generalized
  (draw/shuffle/deal/send work on any stack/fan mat); hand tray renders
  "my hand mat"; 52-card + Dominion templates rebuilt.
- Per-viewer view prefs (local): fan/stack/grid/collapsed + template
  defaults (ownerView/otherView); privileged-view outline + 👁 badge.
- Message log: union-by-id log in TableState; visibility changes logged;
  log panel UI.
- Tests: mat entry rules, visibility derivation, view-permission ceiling,
  log merge convergence; integration tests updated.

## M8 — Actions (SPEC §12)
- Action registry (core verbs) + bindings JSON with cascade
  (platform → gamebox → user).
- Hover buttons (with expandable ▾ menu), context menu, Space command
  palette, key sequences (`f` flip, `d` draw, `s<letter>` send-to-mat),
  auto mat letters with pending-badges.
- Starter binding templates: card-game, board-game.

## M9 — Gamebox (SPEC §13)
- Gamebox package format: defs, finite supplies, bindings, layouts,
  reference pages (readable without spawning).
- Game mat (docked meta: name, seats, turn marker, score) + named
  instances ("my tables" in lobby).
- Settlers of Catan gamebox: slot-graph board (hex/vertex/edge slots),
  finite per-color pieces, resource/dev stacks, robber, number tokens.
