# Templates & custom card sets

Ludwig has no game-specific code. Games are just arrangements of entities,
and two JSON formats let you capture and share them.

## Table templates

A template is an ordinary saved table — no special format, no stripping. To
make one:

1. Set up a table the way the game starts (supply piles, zones, scoreboard…),
   **before dealing** anything into hands.
2. Click **export** in the toolbar.
3. Anyone can load it into a **fresh** table with **import**. The import is
   broadcast, so one player importing sets the table for everyone.

The file is the same shape as a full table export:

```jsonc
{
  "entities": { "<id>": { "id", "kind", "version", "parent", "pos", "locked", "config", "state" }, ... },
  "tombstones": {}
}
```

Built-in templates (lobby gallery): empty sandbox, 52-card deck, and
Dominion (base set, "First Game" kingdom).

## Custom card sets

**+ add to table → Import card set…** turns a small JSON file into a shuffled
deck of text cards — enough for Dominion-style games without any art.

```jsonc
{
  "name": "My Expansion",       // deck label
  "facePolicy": "down",         // optional: "down" (default) or "up"
  "shuffle": true,              // optional: default true
  "cards": [
    {
      "title": "Village",             // required
      "body": "+1 Card, +2 Actions",  // rule text (\n for line breaks)
      "sub": "$3 · Action",           // bottom line, e.g. cost · type
      "color": "#4a4f58",             // title/accent color
      "image": null,                  // or an image URL instead of text
      "count": 10                     // copies (default 1)
    }
  ]
}
```

Limits: every card needs a `title`; `count` is 1–200; 1000 cards max per set.
See [examples/cardset-example.json](examples/cardset-example.json).

Tip: import several sets side by side (one deck each) to build supply piles,
then **export** to capture the whole layout for next time.
