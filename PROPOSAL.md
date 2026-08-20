# v4 — fewer blocks, richer configuration

> Status: **agreed direction** (2026-07, playtest feedback folded in).
> The thread running through all of it: finish what §15 started — every
> "thing" is one of a tiny set of kinds; every behavior, gesture, and menu
> is configuration layered on top; and configuration ships with defaults so
> the common case is one click. Implementation lands as PLAN.md M13–M16.

## 1. Selection is the missing primitive

Most act-on-many ideas stop being features and become one mechanism if we
make **selection a first-class set of entities**:

- **⌘/Ctrl-click** toggles an item in/out of the selection; plain click
  replaces it. Selected items get a shared outline.
- **Rubber-band: plain drag on the felt or on a region mat's empty area**
  sweeps a rectangle; everything whose center is inside joins the
  selection. **⇧-drag (or middle-drag) pans.** Mats are never moved by
  body-drag (see §2), so the plain gesture is free for selecting.
- **Move:** dragging any selected item moves the whole selection rigidly
  (one atomic batch; one undo).
- **Actions take a selection.** SPEC §12 already declares
  `appliesTo(selection)` — we finally implement it. `flip` on five cards
  flips five, `roll` on three dice rolls three, one batch each.
- **"All of a type" is a selection shortcut**, not a new action per kind:
  a mat's menu offers `Select all cards here` plus auto-derived one-click
  compounds (*Flip all cards*, *Roll all dice*); item menus get
  `Apply to all <kind>s on this mat →` — same mechanism, two anchors.

## 2. Mats are handled, not body-dragged

- Every mat grows **move handles at the midpoint of each side** and the
  existing **resize handle** at the corner — all invisible until the
  pointer hovers the mat.
- A stack of cards is a mat like any other: on hover it shows its dotted
  outline and handles. **Body-drag always takes the top item; handles move
  the pile.** The ⌥/⌘-drag modifier dies. Token piles and money stacks get
  the same treatment (handles to move the pile, body-drag takes one).
- **"Stack" is a view option on a mat**, not an identity: it renders items
  of given kinds as one image with a few peeking out below.
  `view.stackKinds` (default: all) lets a mat stack its cards while its
  tokens sit loose on top of or beside them.
- **Fit-contents view:** a mat view option that keeps the outline hugging
  its contents (no resize handle while active) — a bare stack of cards
  shrink-wraps to the stack.

## 3. Grids everywhere, escapable

- New mats default to **grid placement on**; the table (root mat) can have
  a grid too (shipped in M11).
- Holding **⌥ while dragging bypasses snapping** on any grid mat (the key
  is free once stack-moving stops using it).

## 4. Values, not labels

- Items get a named-value map: `config.values: { cost: 3, strength: 5 }`.
  Chips keep a label *and* carry `values.value`; cards can carry several.
- A stack (mat or token pile) can be configured to **show the sum of any
  named value** — a pot of chips shows its total, a Dominion deck can
  show total cost. Merging token stacks sums correctly by construction.
- "Add 20 × $5 chips" dissolves into: spawn a chip, set value/count in
  **Item settings…** (a sibling of Mat settings for every item kind), or
  **Duplicate** (⌘D) an existing one.
- **Dice lose `config.count`** — one die is the primitive; "2d6" is two
  dice in a *dice tray* mat whose quick action rolls everything in it.

## 5. Buttons on mats

A mat can carry **always-visible, configurable buttons** —
`config.buttons: [{ label, action | macro }]` — rendered on its edge.
The classic uses: a Draw button on the deck, a "Roll" button on the dice
tray, "Reset round" on the game mat. Buttons are bindings (§12 cascade),
so gameboxes and users can add them without code.

## 6. Generators: infinite supplies

One mat config flag, no new kind: `"supply": "infinite"`. Pulling from an
infinite mat **clones** the top item (fresh id); returning an item to it
**destroys** the item (banks absorb money). Renders a ∞ badge instead of
a count. Infinite $5 chips, endless Coppers, a blank-note dispenser — all
with existing gestures. Finite supplies stay finite stacks.

## 7. Boards are data: slot-graph generators

Catan proved slots-mats; tiles are already ordinary hex tokens. Two
additions make boards buildable from config:

1. **Slot generators**: `placement.generate: { kind: "hexgrid"|"squaregrid",
   radius/size..., classes: {...} }` expands to the slot list at load —
   the 145 hand-built Catan slots become one line.
2. **`deal-to-slots`**: deal items from a stack onto empty slots whose
   `accepts` match. Random Catan setup becomes a 4-step macro (shuffle
   tiles → deal-to-slots → shuffle chits → deal-to-slots); the human
   places the robber — that's rules, not physics.

Hex tiles, chit tokens, and slot boards are general primitives for any
gamebox.

## 8. Macro/step vocabulary

Steps gain an optional **`where` filter** (`{ kind, title, tags }`):
"gather all Coppers from the table", "flip every card in this row".
Full set: `deal` (N to group), `deal-to-slots`, `gather` (group | 'table'
| mat, with `where`), `shuffle`, `flip`, `roll`, `move`.

## 9. Defaults that teach themselves: quick actions & gestures

Every entity type has an ordered **quick-action list** from the cascade
*platform → gamebox → user* (`config.quickActions`):

- **Hover buttons** show the first 2–3, then `⋯` (today's UI, made
  configurable).
- **Gestures map to positions, consistently:** double-click → quick
  action #1 (card: flip · deck: draw · die: roll — today's behaviors,
  derived instead of special-cased); ⌥-double-click → #2. The hover strip
  shows the gesture hint per button (§15.6).

## 10. Private mats, reworked

Every mat shows its items the same way to every player (views differ per
viewer; *visibility* doesn't) — **unless it is flagged `private`**:

- Private mats are visually distinct: **thick solid borders** (normal mats
  are dotted); **your own** private mats are extra-thick/accented so
  ownership is obvious at a glance.
- They carry an **owner or owner list**, and non-owners get a limited
  view subset chosen by config: backs only · count only · existence
  hidden · and optionally **positions hidden** (you can't watch the owner
  rearrange their hand).
- **Placement of private mats is per-viewer** (already true via arbitrary
  positioning): mine at the bottom, yours wherever I like. Convenience
  arrangements: *gather opponents' private mats to the side* and *lay
  them in a circle around the table* — one click, local-only.
- The advanced faces/count/existence spectrum remains underneath for
  gamebox authors; `private` + presets is the player-facing surface.

## 11. Export, saves, and the log

- **Export = save = template**: exports drop `tombstones` (dead weight in
  a fresh room) and **keep the log** — an export is a resumable game.
- **Clear log** action (log panel) for pristine start-of-game saves.
  Union-CRDT logs need a watermark, not deletion: `logCleared: { at,
  version }` (LWW); entries with `at ≤ watermark` drop on merge/render.

## 12. Spawning: one configurable palette

"Add to table" entries are **presets, not kinds** — data a gamebox can
extend. Default menu shrinks to:

```
＋ add to table
  ▤ Mat…            → settings-first dialog; preset chips: deck · discard ·
                      zone · face-down zone · grid · hex grid · dice tray ·
                      board (slot graph)
  🂠 Cards…          → 52-card deck · import card set · blank card
  ● Token / chips…  → shape, color, value, count (remembers last)
  ⚄ Die             → d6; sides in Item settings
  # Counter · ≡ Scoreboard · ⏱ Timer · 🗈 Note
  ⬡ Game setups     → Catan · Dominion · imported gameboxes
```

## 13. Kind dissolution watchlist (deferred)

Revisit **after playtesting v4**: counter ≈ token with a value and ±
quick actions; scoreboard ≈ mat of per-player counters; note ≈ card with
an editable, always-public face; token piles ≈ stack-view mats.

## 14. Proposed menus

**Felt:** Table settings… · Add to table… · Select all · Clear log.

**Mat:** content actions (Draw, Flip top, Shuffle, Deal…, Search,
Gather…, *Flip all cards*, *Roll all dice*) · Select all items · Mat
settings… · Pin to my tray · My view (stack kinds · fit contents …) ·
Position · Annotation… · Duplicate · Delete.

**Card:** Flip · Take to hand · Send to mat… (s) · Apply to all cards
here → · Item settings… · Position · Annotation… · Duplicate · Delete.

**Token/chips:** Take 1 · Split… · Apply to siblings → · Item settings…
(shape/color/label/value/count) · Position · Annotation… · Duplicate ·
Delete.

**Die:** Roll · Roll all dice here · Item settings… (sides) · Position ·
Annotation… · Duplicate · Delete.

## Decisions (locked 2026-07)

1. Plain drag on felt/region mats rubber-bands; **⇧-drag pans** (mats move
   by handles only, so the plain gesture is free).
2. Named values on items; chips have label *and* value; stacks can show
   any value's sum.
3. Dice `count` dropped; "2d6" = two dice in a dice tray.
4. Infinite supplies: clone-on-pull; returning destroys.
5. Kind dissolution deferred until after v4 playtesting.
6. Sequencing: M13 selection & handles → M14 views, values, item settings,
   buttons, gestures → M15 supplies & boards → M16 privacy & front door.

---

# v5 — the card-play pass

> Status: **DRAFT, for discussion** (2026-08, after the first real Dominion
> playtest). Items marked ✅ landed with M19; everything else is proposed.
> The organizing idea is unchanged from v4 — kinds render, configuration
> behaves — plus one new lens: **at card-game speed, every common motion
> must be one gesture or two keys**, and the pieces those motions are built
> from should be orthogonal primitives, not fused specials.

## 1. Readable cards: summary faces + the inspector ✅

- A card face with `badges: string[]` renders **title + art + badges only**
  at table size; the rules text lives in the **inspector**, a panel that
  opens ~⅓s after hovering any visible card face (`v` pins it). Small faces
  answer "which card is this?"; the inspector answers "what does it do?".
- Cardset authors write badges by hand or derive them (Dominion pulls
  `+N Cards/Actions/Buys` out of the rules text at generation time).
- Open questions: (a) should the inspector be a **placeable widget** (a
  viewer-local chrome piece — tension with "no chrome-only objects") or
  stay a fixed panel with a corner preference? (b) touch: long-press?

## 2. The verb grammar: count × verb × target

One action registry, four surfaces (hover strip, context menu, palette,
keys) — that's v4 §9 and it stays. v5 composes *sentences* around it:

- **Count prefix** ✅: `5 d` = draw five. Any digit(s), then an action key.
  Actions opt in (`args.n` natively, or `countable: 'repeat'`).
- **Target suffix** (exists): `s` + mat letter = send-to. Same shape.
- **Parameterized compound ids** ✅ (`reshuffle:<mat label>`): action ids
  are strings, so buttons, double-click quickActions, and macros all speak
  one language, and a parameter names a mat by label. Proposed family,
  added only as a game needs them: `send-all:<label>` (sweep this mat's
  items there), `deal:<n>` (skip the prompt). NOT proposed: per-game verbs.
- Principle: **two orthogonal primitives beat one fused one** — count +
  draw, not "draw5"; reshuffle:<label> not "dominion cleanup".

## 3. Buttons where the designer wants them

Mat buttons exist (v4 §5) ✅ and now include compounds. Proposed next:

- `buttons: [{ label?, icon?, action, anchor?: 'n'|'s'|'e'|'w' }]` — edge
  placement, so a deck's ⟳ can sit beside its discard rather than below.
- **Item buttons**: the same array on any item's config (a "roll" pip on a
  die, "flip" on a settings card). Same registry, same renderer.
- Buttons remain attached to mats/items — no free-floating button objects
  (that would be chrome-only, rejected by principle).

## 4. Players as seats (the big open design)

What already exists: `PlayerInfo { id, name, color }`; mats with
`ownerId`/`owners`; the privacy spectrum (`backs`/`count`/`nothing`) with
per-facet visibility rules; `positioning: 'arbitrary'` so each viewer
places others' private mats in their own view; the hand tray as a pinned
view of an ordinary mat. **A hand is already just a private fan mat** —
the model the playtest asked for is largely built. Proposed additions:

- **Seat kits.** A gamebox declares per-seat furniture as a mat group
  (`groups: ['seat 1']` — Dominion's Deck/Discard pairs are the shape).
  One click on a seat's "claim" affordance sets me as owner of the
  group's mats and tints them my color. No new kind; a compound action
  (`claim-seat:<group>`) plus a roster affordance.
- **Action attribution** (cheap, high value): every mutation already
  carries `version.actor`. Render a transient ring in the actor's color
  (~1s fade) around entities changed by a remote commit. Local-only,
  zero protocol change; the log already narrates, this makes it glanceable.
- **Owner-colored chrome**: an owned mat's ring/label uses the owner's
  roster color instead of the generic accent, so "whose is that?" reads
  at a glance — same place attribution flashes.
- **Arrange-others polish**: arbitrary positioning works today; add a
  sensible default (new peers' private mats auto-arrange along my top
  edge) so the feature is discovered.

## 5. Sums beyond one value

`showSum: 'coin'` ✅ puts one Σ badge on a mat. Proposed: `showSum` accepts
a list (`['coin', 'vp']` → a row of Σ badges). Still config, still one
renderer. Not proposed: computed expressions — a sum per named value is
enough until a playtest says otherwise.

## 6. Deck ↔ discard pairing

`reshuffle:<label>` ✅ is the pairing, expressed where it's used. If
playtests show the two-click rhythm (empty deck → button) still drags,
the escalation path is `autoReshuffle: '<label>'` on the deck — drawing
from empty sweeps + shuffles + draws in one motion. Deferred until felt.

## Decisions (2026-08 round 2) — landed ✅

1. **Inspector is a moveable, resizable screen-chrome panel** ✅ — pinned
   (`v`), its header bar drags it anywhere and a corner grip resizes;
   geometry persists per browser. It is chrome like the tray/log, never a
   table entity, so "no chrome-only objects" (a rule about the shared
   felt, not the screen) is untouched.
2. **Players choose their color at join** ✅ — swatch row + custom color
   input in the lobby, saved with the identity.
3. **Attribution: 2s actor-colored flash** on remotely-changed entities ✅
   (version.actor was already on every mutation — local rendering only)
   **plus fading cursor trails** per peer ✅.
4. **Count prefix extends to send** ✅ (`3 s` + letter moves the top 3) and
   **`draw:<n>` button presets** ✅ (Dominion decks ship `Draw 5`); the
   count prefix remains the arbitrary-n one-off at runtime.

## Decisions (2026-08 round 3) — landed ✅

1. **Badges and values are authored explicitly, never extracted from
   text** ✅ — the Dominion generator hand-writes every chip.
2. **Card layouts: per-size field lists** ✅ — `layout: { small: [...],
   large: [...] }` on a face names which fields render, in order
   (title / art / badges / body / sub / center). Omitted size = default.
3. **Inspector parks in either space** ✅ — pinned, a 📌 toggle switches
   screen-parked (stays put while the table pans) vs felt-parked (tracks
   a table spot, your view only). Position, size, and mode persist.
4. **The hand tray is draggable chrome** ✅ — ⠿ grip moves it anywhere
   (persisted); double-click re-docks bottom-center. Unpinning still
   returns the hand to the felt as an ordinary fan mat.
5. **Seat kits auto-assign on join** ✅ — mats grouped `seat <n>` form a
   kit; sitting down claims the lowest unowned one (rejoins keep theirs;
   a full table just means you spectate with a hand). Colors are chosen
   at join and changeable any time via your roster dot. Owned mats show
   the owner's color dot on their label.
6. **autoReshuffle** ✅ — deck config `autoReshuffle: '<label>'`; a draw
   that runs short sweeps the linked mat in and shuffles first, one
   commit. The ⟳ chip on the deck marks the link; hovering it outlines
   the linked mat. Dominion's decks use it.

## Still open

1. **Placeable mat buttons** (approved in principle): per-button position
   on the mat, moved via the button's context menu. Scheduled as its own
   pass (M22) — placement model (anchor points vs free x/y), drag UX,
   and gamebox syntax to be designed then.
