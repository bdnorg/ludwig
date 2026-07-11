# Ludwig — Platform Specification

> **Note:** Part I (§1–9) describes the v1 platform as built (M1–M6).
> Part II (§10–14) is the v2 design — Mats, Actions, Gameboxes — which
> **supersedes** the Deck/Hand/Zone kinds of §3 via a clean refactor.

Ludwig is a browser-based virtual tabletop for board and card games. It models
**physical objects** — cards, decks, hands, tokens, dice, timers, boards — not
game rules. Players manipulate objects the way they would at a real table; the
semantics of the game live in the players' heads, exactly as they do in real
life.

## 1. Design Principles

1. **No rules engine.** The platform knows a card can be flipped, drawn,
   stacked; it never knows what the card *means*.
2. **Static deployment.** The client is static HTML/JS/CSS servable from any
   file host (GitHub Pages, S3, a USB stick). No application backend.
3. **Peer-to-peer.** Players' browsers communicate directly over WebRTC data
   channels. Signaling rides on existing public infrastructure via
   [Trystero](https://github.com/dmotz/trystero) (BitTorrent tracker / Nostr /
   MQTT strategies), so no server of ours is required even for introductions.
4. **Honor-system visibility.** Every peer holds the full table state; the
   renderer simply doesn't show you faces you aren't entitled to see. This is
   the same trust model as a physical table — you *could* peek, but you don't.
   (A host-authoritative mode is a possible later addition; see §9.)
5. **Everything is JSON.** Entity configuration and state are plain JSON
   objects, passed in messages, saved to disk, and hand-authorable as game
   templates.

## 2. Core Concepts

### Table (room)
A session. Identified by a human-shareable room code (e.g. `ludwig-fuzzy-otter-42`),
which doubles as the Trystero room key. A table contains a set of **entities**
and a roster of **players**.

### Player
An ephemeral peer identity: `{ id, name, color, seatIndex }`. `id` is a random
UUID minted per browser and kept in `localStorage` so a refresh rejoins as the
same player.

### Entity
Everything on the table is an entity with a common envelope:

```jsonc
{
  "id": "e_8f3a...",          // uuid
  "kind": "card",             // card | deck | hand | token | dice | counter | timer | zone | board | note
  "version": { "clock": 41, "actor": "p_ab12" },  // Lamport clock + actor id (see §5)
  "parent": null,             // null = on the table; or an entity id (deck, hand, zone, another token/card)
  "pos": { "x": 312, "y": 480, "z": 7, "rot": 0 },  // table coords when parent == null
  "locked": false,            // locked entities can't be dragged (boards, zones)
  "config": { ... },          // kind-specific, immutable-ish (what the object IS)
  "state": { ... }            // kind-specific, mutable (what the object is DOING)
}
```

`config` vs `state`: a card's faces are config; whether it is face-up is state.
Both travel in the same JSON; the split is a convention that makes templates
and resets easy.

## 3. Entity Kinds

### Card
```jsonc
"config": {
  "front": { "text": "A♠", "image": null, "html": null },  // any of these
  "back":  { "image": "backs/red.svg" },
  "size": { "w": 63, "h": 88 }                              // mm-ish units
},
"state": { "faceUp": false }
```
Visibility of the front face is derived (§4), never stored per card.

### Deck / Pile
An ordered stack of card ids. A deck and a discard pile are the same kind with
different config.
```jsonc
"config": { "label": "Draw", "facePolicy": "down" },  // down | up (discard piles are "up")
"state":  { "cards": ["e_c1", "e_c2", ...] }          // index 0 = top
```
Operations: shuffle, draw N (to hand or table), deal N to each player, cut,
flip-top, search (spreads contents visibly — an explicitly public act, like
fanning a deck at the table).

### Hand
A per-player container. Cards in a hand render in the owner's hand tray.
```jsonc
"config": { "ownerId": "p_ab12" },
"state":  { "cards": [...], "revealedTo": []  }   // extra player ids (or "all") who may see faces
```
Everyone always sees hand *counts* (like the backs of fanned cards); only
owner + `revealedTo` see faces.

### Token
A generic piece: pawn, cube, chip, bead. Can sit on the table, on a board
position, or stacked on another entity (`parent` = that entity's id).
```jsonc
"config": { "shape": "disc", "color": "#c0392b", "label": "5", "size": 20 },
"state": {}
```

### Dice
```jsonc
"config": { "sides": 6, "count": 2 },
"state":  { "values": [3, 5], "rolledBy": "p_ab12", "rolledAt": 1720000000 }
```
Rolling: the actor generates results with `crypto.getRandomValues` and
broadcasts them (honor system, §4).

### Counter / Scoreboard
Named numeric values anyone can adjust; a scoreboard is a counter group with a
row per player. `"state": { "values": { "p_ab12": 24, ... } }`

### Timer
Countdown or stopwatch. State stores a target/start timestamp so peers render
it locally without tick messages.

### Zone
A labeled rectangular region on the table with optional behaviors:
snap-to-grid, auto-face-down on enter ("play your card face down here"),
per-player ownership tint. Zones are how boards get functional regions.

### Board
A locked background image with optional named snap-points/regions
(`config.snapPoints: [{ id, x, y, label }]`). Out of scope for v1 sandbox but
the entity model reserves it.

### Note
A freeform sticky note / text label on the table.

## 4. Visibility Model

Visibility is a pure function of state — never a stored ACL per card:

| Situation                          | Who sees the face        |
|------------------------------------|--------------------------|
| Card on table, `faceUp: true`      | everyone                 |
| Card on table, `faceUp: false`     | no one                   |
| Card in deck/pile                  | per deck `facePolicy` (top card only) |
| Card in hand                       | owner + `revealedTo`     |

All peers hold all data (honor system). "Peeking" via dev tools is possible and
accepted, as agreed. Shuffles and dice rolls are generated by the acting peer
and broadcast as outcomes; fairness is likewise social. (Commit-reveal shuffles
are a possible later hardening; see §9.)

## 5. State Synchronization

Topology: full mesh over Trystero WebRTC data channels. No sequencer in the
hot path.

- **Per-entity last-writer-wins.** Every entity carries a Lamport clock and the
  writing actor's id. On receiving an update, a peer applies it iff
  `(clock, actorId)` is greater than its local version. Concurrent grabs of the
  same card resolve deterministically and identically on all peers — and
  socially, the same way two hands reaching for one card resolves at a real
  table.
- **Atomic ops for multi-entity moves.** Drawing a card touches the deck's
  list *and* the card's parent; deal touches many. These ship as a single
  `op` message applied transactionally, so no peer ever sees a card in two
  places.
- **Drag streaming.** While dragging, position updates stream at ~20 Hz as
  ephemeral messages (no clock bump); the drop commits a versioned update.
  Remote cursors ("pointer" messages) show each player's mouse with their
  color.
- **Host role (bookkeeping only).** The longest-present peer is *host* — not
  an authority, just the designated snapshot-provider. A joining peer requests
  `snapshot`; the host replies with the full entity map. If the host leaves,
  the next longest-present peer inherits the role. If all peers leave, the
  table lives on in each participant's `localStorage` and any returning peer
  can reseed it.

### Message protocol (JSON, one Trystero action per type)
| Message      | Payload                                        |
|--------------|------------------------------------------------|
| `join`       | player profile                                 |
| `snapshot-req` / `snapshot` | — / full entity map + roster    |
| `create` / `update` / `delete` | entity (or id + versioned partial) |
| `op`         | `{ name: "draw" \| "shuffle" \| "deal" \| ..., args, resultingUpdates: [...] }` |
| `pointer`    | `{ x, y }` (ephemeral, unversioned)            |
| `drag`       | `{ id, x, y }` (ephemeral)                     |
| `chat`       | text                                           |

## 6. Persistence & Templates

- **Autosave:** full table state to `localStorage` per room code.
- **Export/Import:** table state as a downloadable JSON file.
- **Templates:** a game setup (deck composition, tokens, zones, scoreboard,
  initial layout) is just an exported table with `state` reset — hand-authorable
  JSON. v1 ships one built-in template: **standard 52-card deck** (+ jokers
  toggle). Templates for specific games (Dominion-style custom decks) are the
  natural extension path and require zero platform changes beyond card art.

## 7. Client UI (Svelte + TypeScript + Vite)

- **Table surface:** a pan/zoom canvas (CSS-transformed DOM/SVG — cards and
  tokens are DOM nodes, which keeps text rendering, accessibility, and hit
  testing simple at tabletop entity counts).
- **Interactions:** drag to move; double-click to flip; drag onto deck to
  return; drag off deck to draw; right-click/long-press context menu for
  kind-specific actions (shuffle, deal…, roll, lock, reveal hand…).
- **Hand tray:** docked at the bottom, shows your hand fanned; drag between
  tray and table.
- **Spawn palette:** add deck / dice / tokens / counter / scoreboard / timer /
  zone / note to the table.
- **Roster & presence:** player list with colors; remote cursors.
- **Lobby:** create table (generates room code) or join by code/link
  (`…/#/t/<room-code>`).

## 8. v1 Acceptance Test

Three-plus people, each in their own browser on different networks, can play
**poker, hearts, and euchre** end to end using only: the 52-card template,
hands, face-up/face-down play to the table/zones, shuffling, dealing, a
scoreboard, and chips (tokens). No feature may special-case any of these games.

## 9. Explicit Non-Goals (v1) / Future Directions

- Rules enforcement of any kind — permanently out of scope.
- Host-authoritative or commit-reveal modes for stronger cheat resistance.
- Boards with snap-points, custom card-set editor/importer, images-from-URL decks.
- Spectators, voice/video, mobile-optimized layout, TURN fallback for hostile NATs.

---

# Part II — Mats, Actions, Gameboxes (v2)

Design principle (unchanged): simple, powerful primitives with good defaults,
defined in templates, overridable. Gamebox authors may face complexity;
players must not — advanced options stay folded away until a game needs them.

## 10. The Mat

One container kind absorbs deck, hand, zone, discard pile, and board. The
table itself is the root mat (`parent: null` = "on the table").

```jsonc
{
  "kind": "mat",
  "config": {
    "label": "Hand",
    "letter": "h",                  // keyboard-target badge (§12)
    "ownerId": null,                // or a player id (hands, player boards)
    "placement": {
      "type": "free",               // free | grid | slots | stack | fan
      "grid": { "size": 40 },       // grid only
      "slots": [                    // slots only (Catan: hexes/vertices/edges)
        { "id": "hex-0", "x": 120, "y": 80, "accepts": ["tile"] }
      ]
    },
    "faceDefault": "keep",          // up | down | keep — applied to cards on entry
    "visibility": {                 // each: "public" | "owner" | [playerIds] ([] = nobody)
      "faces": "owner",             //   who sees fronts of contained cards
      "count": "public",            //   who sees how many items it holds   (advanced)
      "existence": "public"         //   who sees the mat at all            (advanced)
    },
    "image": null,                  // board art URL
    "size": { "w": 300, "h": 200 }  // extent for free/grid/slots; stacks/fans auto-size
  },
  "state": { "order": ["cardId", ...] }   // z/stack order; membership authority
}                                          // remains child.parent (§3 rule)
```

The old kinds become configurations:

| v1 kind      | Mat configuration |
|--------------|-------------------|
| Deck         | `stack`, faces `[]`, faceDefault `down` |
| Discard pile | `stack`, faces `public`, faceDefault `up` |
| Hand         | `fan`, faces `owner`, count `public`, ownerId set |
| Zone         | `free`, faceDefault per zone, faces `public` |
| Board        | `free`/`grid`/`slots` + `image` |
| Table        | implicit root `free` mat |

Mats nest arbitrarily (board → tile → token). A "stack of tokens" is a
stack-mat of tokens — the M4 chip-stack special case dissolves into this.

**Entry rules:** dropping an item into a mat applies `faceDefault` (on entry
only, exactly like today's auto-face-down zones) and snaps per `placement`.
Visibility is *derived at render time from the containing mat* — never
stamped onto items — so moving a card between mats never needs a visibility
mutation.

## 11. Shared state vs. local view

Two layers, never confused:

- **Shared, synced, versioned:** everything in §10, including visibility.
  Any visibility change appends to the **message log** (below).
- **Local, per-viewer, in localStorage:** how *I* render a mat — `fan`,
  `stack`, `grid`, `collapsed` (count chip). Templates set defaults per
  relationship (`ownerView: fan`, `otherView: stack`). Changing my view of
  your hand never touches shared state, and no view can show me faces the
  visibility policy denies.

**Privileged-view indicator:** any mat where I can see more than some
connected player renders with a distinct outline and a 👁 badge by its label.

**Message log:** `TableState` gains `log: Record<id, {at, actor, text}>` —
merge is union-by-id (CRDT-set, same convergence story as entities), render
sorted by `at`, capped. Visibility changes always log ("Beth made Hand
visible to everyone"); chat and gamebox events ride the same log later.

## 12. Actions & bindings

All interaction behavior moves out of hardcoded handlers into a declarative
registry.

- **Action:** `{ id, label, icon, appliesTo(selection) → bool, run(ctx, selection, args) → Mutation[] }`.
  Core verbs: draw, flip, shuffle, send-to-mat, deal, search, split, roll,
  lock, reveal, delete…
- **Bindings** map triggers → actions, in JSON, cascading
  *platform defaults → gamebox → user*:

```jsonc
{ "on": "dblclick", "target": "mat[placement=stack]", "action": "draw-to-hand" }
{ "on": "hover",    "target": "mat[placement=stack]",
  "buttons": ["draw", "shuffle", { "menu": ["deal", "search", "flip-top"] }] }
{ "on": "drop", "from": "card", "to": "mat", "action": "move-into" }
{ "on": "key", "seq": "s ?mat", "action": "send-to-mat" }   // s then a mat letter
{ "on": "key", "seq": "f", "action": "flip" }
```

One registry, four surfaces: **hover buttons** (first N bindings; a `menu`
entry expands), **context menu**, **command palette** (Space: fuzzy list of
applicable actions with their shortcut hints — the discoverability layer),
and **keys** (single keys plus vi-like stateful sequences; `?mat` prompts
for a mat letter, badges appear on all mats while pending). Selection
context = hovered or last-clicked item.

v1 scope: palette + core verb set + auto-assigned mat letters; bindings are
JSON-editable but there is no editor UI yet.

## 13. Gamebox & game instances

A **gamebox** is a JSON package of definitions, not state:

```jsonc
{
  "name": "Settlers of Catan",
  "defs": { ... item & mat templates ... },
  "supplies": { "settlement-red": 5, "road-red": 15, "wood": 19, "dev-card": 25 },
  "bindings": [ ... ],
  "layouts": { "standard": [ ... initial table ... ] },
  "reference": [ { "title": "Turn summary", "md": "..." } ]
}
```

- **Supplies** may be finite; taking/returning items goes through the
  gamebox, which tracks remaining counts.
- **Reference** pages are readable in a panel without spawning anything.
- The **game mat** is a docked mat holding meta state — instance name,
  seats, turn marker, score — visible by default, perusable but compact.
  It carries no rules engine: "whose turn" is a marker players move.
- A **game instance** = a room (this already gives naming, isolation,
  localStorage persistence, and switching without loss); the lobby grows a
  "my tables" list to switch between named instances.

## 14. v2 milestones

- **M7 — Mats:** unified Mat kind (clean refactor of deck/hand/zone/chip-stack),
  visibility (faces/count/existence + progressive disclosure), per-viewer
  views + privileged-view indicator, message log, 52-card & Dominion
  templates rebuilt on mats.
- **M8 — Actions:** registry + bindings cascade, hover buttons with
  expandable menu, command palette, mat letters & send-to sequences,
  starter binding templates (card game / board game).
- **M9 — Gamebox:** package format, finite supplies, reference panel, game
  mat + named instances in lobby, **Settlers of Catan** as the proving
  gamebox (slot-graph board, finite per-color pieces, resource/dev stacks).
