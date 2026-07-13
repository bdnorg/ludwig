<script lang="ts">
  // The front-door instructions page (#/help): how a table works and every
  // gesture the app knows — a feature users can't find is a bug (SPEC §15).
  const sections: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: 'The table',
      rows: [
        ['Move anything', 'drag it'],
        ['Pan / zoom', '⇧-drag or middle-drag the felt / scroll wheel'],
        ['Select several things', '⌘/Ctrl-click, or rubber-band drag on the felt'],
        ['Act on a selection', 'drag any member to move all · f flips all · x deletes all'],
        ['Undo your last action', '⌘Z / Ctrl-Z or the toolbar button'],
        ['Bring to front / send to back', '] / ['],
        ['Table settings (felt color, grid, entry rules)', 'right-click the felt'],
        ['Add decks, dice, chips, notes…', '+ add to table in the toolbar'],
        ['Annotate anything', 'right-click → Annotation… (hover the 📝 to read)'],
      ],
    },
    {
      title: 'Cards & mats',
      rows: [
        ['Take the top card of a deck', 'drag it off the pile'],
        ['Move a whole deck or mat', '⇧-drag it, or grab its bottom handle'],
        ['Draw to your hand', 'double-click a deck (or press d)'],
        ['Flip a card', 'double-click it (or press f)'],
        ['Play from your hand', 'drag out of the tray — ⇧ plays face down'],
        ['Reorder your hand', 'drag a card sideways within the tray'],
        ['Return a card to a deck', 'drop it on the deck’s ◎ bullseye (top-right)'],
        ['Shuffle, deal, search…', 'right-click a deck, or its hover buttons'],
        ['Send to a mat by key', 's, then the mat’s letter (badges appear)'],
        ['Mat label, color, placement, privacy', 'right-click → Mat settings…'],
        ['Private mats', 'thick solid ring — extra-thick accent means yours; set owners & hidden positions in Mat settings'],
        ['Arrange others’ private mats', 'right-click the felt → side / circle (your view only)'],
        ['Pin a mat to your tray', 'right-click it (your hand starts pinned)'],
        ['Reveal your hand', '“reveal all” in the tray (logged for everyone)'],
      ],
    },
    {
      title: 'Everything else',
      rows: [
        ['Command palette', 'Space — lists every action for what you point at'],
        ['Roll dice', 'double-click them (or press r); a tray’s Roll button rolls all'],
        ['Skip a grid snap', 'hold ⌥ while dropping (mats snap by default)'],
        ['Edit an item (value, sides, label…)', 'right-click → Item settings…'],
        ['Pot totals', 'chips carry a value; stacks show the sum'],
        ['Infinite bank / supply', 'Mat settings… → Supply: infinite — pulls copy, returns vanish'],
        ['Duplicate anything', 'right-click → Duplicate'],
        ['Stack anything on anything', 'drop it on the target’s ◎ bullseye — mixed chips, cards, whatever'],
        ['Take one piece off a pile', 'drag it (⇧-drag or the bottom handle moves the pile)'],
        ['Split several off a pile', 'right-click the pile → Split pile…'],
        ['Board slots (Catan)', 'pieces snap to matching hex/corner/edge slots'],
        ['Quick actions (deal, gather…)', 'template-defined buttons, top left'],
        ['Arrange something just for yourself', 'right-click → Position: my view only'],
      ],
    },
  ];
</script>

<div class="help">
  <a class="back" href="#/">← back to the lobby</a>
  <h1>how ludwig works</h1>
  <p>
    Ludwig is a table, not a referee. It knows a card can be flipped, drawn, and stacked — never
    what the card <em>means</em>. Everyone at the table holds the full state and the renderer
    simply hides faces you aren’t entitled to see, exactly like a real table: you
    <em>could</em> peek, but you don’t.
  </p>
  <p>
    Start a table, send the invite link, and play. Everything is saved in your browser per table
    (see “My tables” in the lobby) — and a table exported to a file doubles as a template anyone
    can import.
  </p>

  {#each sections as s (s.title)}
    <h2>{s.title}</h2>
    <table>
      <tbody>
        {#each s.rows as [what, how] (what)}
          <tr><td>{what}</td><td>{how}</td></tr>
        {/each}
      </tbody>
    </table>
  {/each}

  <p class="foot">
    No servers, no accounts: peers connect directly over WebRTC. If someone can’t connect,
    have them refresh — a rejoining player is re-seated with the same hand.
  </p>
</div>

<style>
  .help {
    max-width: 44rem;
    margin: 6vh auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  h1 {
    margin: 0;
    letter-spacing: 0.04em;
  }
  h2 {
    margin: 1rem 0 0;
    font-size: 1rem;
    color: var(--accent);
  }
  .back {
    color: var(--muted);
    text-decoration: none;
  }
  .back:hover {
    color: var(--text);
  }
  p {
    margin: 0;
    color: var(--text);
    line-height: 1.5;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  td {
    padding: 5px 10px;
    border-bottom: 1px solid #363d4b;
    font-size: 0.85rem;
  }
  td:first-child {
    color: var(--muted);
    width: 46%;
  }
  .foot {
    margin-top: 1rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
