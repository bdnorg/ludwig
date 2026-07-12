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

Open the app, enter a name, pick a template (sandbox, 52-card deck,
Dominion, or Settlers of Catan), start a table, and send the invite link to
friends. The lobby remembers every player this browser has used — pick one
from the "Playing as" dropdown (each tab can sit at the table as a
different player). Saved tables reappear under "My tables" in the lobby — rename,
reopen, or delete them there. Use
**+ add to table** to spawn decks, chips, dice, counters, scoreboards,
timers, zones, and notes — or import your own card set / saved template
(see [TEMPLATES.md](TEMPLATES.md)). Interactions:

| Action | How |
|---|---|
| Move anything | drag |
| Pan / zoom table | drag background / scroll wheel |
| Take the top card of a deck | drag it off the pile |
| Move a whole deck | ⌥/Alt-drag it |
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
| Change visibility | right-click a mat → Faces/Count (changes are logged) |
| Reveal your hand | "reveal all" in the hand tray |
| Roll dice | double-click them |
| Split a chip stack | right-click → Take 1 / Split stack… |
| Merge chip stacks | drop a stack onto a matching one |
| Adjust scores | +/− on a counter or scoreboard |
| Face-down play area | spawn a face-down zone; cards flip as they enter |
| Resize a zone | drag its corner handle |
| Take one piece off a token stack | drag it (⌥-drag moves the whole stack) |
| Board slots (Catan) | pieces snap to matching hex/corner/edge slots |
| Arrange something just for yourself | right-click → Position: my view only |

Run `node scripts/m4test.mjs`, `dominiontest.mjs`, and `p2ptest.mjs` for the
integration tests (all need the dev server and Chrome).

## Deploy

`npm run build` emits a fully static `dist/` (relative paths — hostable from
any static file server). A GitHub Pages workflow ships in
`.github/workflows/deploy.yml`: push to a GitHub repo, enable Pages
(Settings → Pages → Source: GitHub Actions), and every push to `main`
deploys.
