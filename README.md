# ludwig

A browser-based virtual tabletop for board and card games. Ludwig models
physical objects — cards, decks, hands, tokens, dice — not game rules; the
rules live in the players' heads, exactly as at a real table. See
[SPEC.md](SPEC.md) for the design and [PLAN.md](PLAN.md) for the roadmap.

- **No backend.** Static files; peers connect directly over WebRTC
  ([Trystero](https://github.com/dmotz/trystero), Nostr signaling).
- **Honor-system visibility.** Every peer holds full state; the renderer hides
  faces you aren't entitled to see.
- **Per-entity LWW sync.** Lamport-versioned entities; multi-entity ops
  (draw, deal) apply atomically.

## Develop

```sh
npm install
npm run dev        # dev server
npm test           # unit tests (sync convergence, card ops)
npm run check      # svelte-check + tsc
node scripts/p2ptest.mjs   # 2-browser P2P integration test (needs dev server + Chrome)
```

## Play

Open the app, enter a name, pick a template (sandbox, or a gamebox — 52-card
deck, Euchre, Dominion, Settlers of Catan — fetched from `public/gameboxes/`;
or import any exported table file), start a table, and send the invite link
to friends. Each gamebox in the gallery has a ⇩ download link for its
`manifest.json`, and "Upload a gamebox…" loads any single manifest from disk
(its assets must be absolute URLs or `data:` URIs — a single-file upload
can't carry a directory of images alongside it). The lobby remembers every player this browser has used — pick one
from the "Playing as" dropdown (each tab can sit at the table as a
different player). Saved tables reappear under "My tables" in the lobby — rename,
reopen, or delete them there. Use
**+ add to table** to spawn decks, chips, dice, counters, scoreboards,
timers, zones, and notes — or import your own card set / saved template
(see [TEMPLATES.md](TEMPLATES.md)). Interactions:

| Action | How |
|---|---|
| Move anything | drag |
| Pan / zoom table | ⇧-drag or middle-drag the felt / scroll wheel |
| Select several things | ⌘/Ctrl-click, or rubber-band drag on the felt |
| Act on a selection | drag any member to move all · f flips all · x deletes all |
| Take the top card of a deck | drag it off the pile |
| Move a whole deck or mat | ⇧-drag it, or grab its bottom handle |
| Undo your last action | ⌘Z / Ctrl-Z or the toolbar button |
| Draw a card to your hand | double-click a deck |
| Flip a card | double-click it |
| Play from hand | drag out of the tray (⇧ plays face down) |
| Reorder your hand | drag a card sideways within the tray |
| Bring to front / send to back | ] / [ |
| Resize a note / pick its color | drag its corner / right-click |
| Return a card to a deck | drop it on the deck |
| Shuffle, deal, search… | right-click a deck, or use its hover buttons |
| Command palette | Space (actions for whatever you're pointing at) |
| Keyboard verbs | d draw · f flip · r shuffle/roll · h to hand · x delete |
| Send to a mat | s, then the mat's letter (badges appear) |
| Change my view of a mat | right-click → "My view" (fan/stack/collapsed) |
| Mat label / color / grid / privacy | right-click a mat → Mat settings… (changes are logged) |
| Private mats | thick solid ring (extra-thick accent = yours); owners list + hidden positions in Mat settings |
| Arrange others' private mats | right-click the felt → to the side / in a circle (your view only) |
| Clear the shared log | log panel → clear log (do this before exporting a pristine template) |
| Felt color, table grid, entry rules | right-click the felt → Table settings… |
| Pin a mat to your tray / unpin | right-click a mat (hands start pinned) |
| Annotate anything | right-click → Annotation… (📝 badge; hover to read) |
| Reveal your hand | "reveal all" in the hand tray |
| Roll dice | double-click them (a dice tray's Roll button rolls all) |
| Skip a grid snap | hold ⌥ while dropping (mats snap by default) |
| Edit an item — value, sides, label… | right-click → Item settings… |
| Chip values & pot totals | chips carry a value; stacks show the sum |
| Put buttons on a mat | Mat settings… → Buttons (draw, shuffle, roll-all-dice…) |
| Infinite bank / supply | Mat settings… → Supply: infinite (pulls copy, returns vanish) |
| Random Catan board | the "Random island" quick action (shuffle + deal-to-slots) |
| Shrink a mat to its contents | right-click → My view: fit contents |
| Duplicate anything | right-click → Duplicate |
| Split a chip stack | right-click → Take 1 / Split stack… |
| Stack anything on anything | drop it on the target’s ◎ bullseye (top-right) — mixed items welcome |
| Adjust scores | +/− on a counter or scoreboard |
| Face-down play area | spawn a face-down zone; cards flip as they enter |
| Resize a zone | drag its corner handle |
| Take one piece off a pile | drag it (⇧-drag or the bottom handle moves the pile) |
| Board slots (Catan) | pieces snap to matching hex/corner/edge slots |
| Arrange something just for yourself | right-click → Position: my view only |
| Deal / gather / reset in one click | quick-action strip (template-defined macros) |
| Read a gamebox's rules summary | toolbar → 📖 reference (only shown when the box ships one) |
| How it all works | the lobby's "how it works" page (#/help) |

Run `node scripts/m4test.mjs`, `dominiontest.mjs`, `catantest.mjs`,
`cards52test.mjs`, and `p2ptest.mjs` for the integration tests (all need the
dev server and Chrome). `LUDWIG_URL=https://…/ node scripts/p2ptest.mjs`
smoke-tests a deployed site.

## Deploy

`npm run build` emits a fully static `dist/` (relative paths — hostable from
any static file server). A GitHub Pages workflow ships in
`.github/workflows/deploy.yml`: push to a GitHub repo, enable Pages
(Settings → Pages → Source: GitHub Actions), and every push to `main`
deploys.
