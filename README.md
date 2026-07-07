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

Open the app, enter a name, start a table, and send the invite link to
friends. Spawn a 52-card deck from the toolbar. Interactions:

| Action | How |
|---|---|
| Move anything | drag |
| Pan / zoom table | drag background / scroll wheel |
| Draw a card to your hand | double-click a deck |
| Flip a card | double-click it |
| Play from hand | drag out of the tray (⇧ plays face down) |
| Return a card to a deck | drop it on the deck |
| Shuffle, deal, search… | right-click a deck |
| Reveal your hand | "reveal all" in the hand tray |
