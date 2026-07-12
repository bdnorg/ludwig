// Core entity model. See SPEC.md §2–3 and Part II §10.
// Every entity shares a common envelope; `config` is what the object IS,
// `state` is what it is DOING. Both are plain JSON and travel in messages.

export interface Version {
  clock: number; // Lamport clock
  actor: string; // player id; tiebreak for equal clocks
}

export interface Pos {
  x: number;
  y: number;
  z: number;
  rot: number;
}

interface Base<K extends string, C, S> {
  id: string;
  kind: K;
  version: Version;
  /** null = on the table (the root mat); otherwise the id of a containing mat */
  parent: string | null;
  /** coordinates relative to the containing mat (table coords at root);
   *  ignored inside stack/fan mats, where mat order rules */
  pos: Pos;
  /** 'absolute' (default): pos is shared — moving it moves it for everyone.
   *  'arbitrary': pos is only a default starting point; each viewer places
   *  it locally and moves never sync (SPEC §10). */
  positioning?: 'absolute' | 'arbitrary';
  locked: boolean;
  /** freeform sticky text on any entity (📝 badge, SPEC §15) */
  annotation?: string;
  config: C;
  state: S;
}

/** A renderable card face. Two text layouts: corner/center (playing cards)
 *  and title/body/sub (Dominion-style text cards); `image` is a URL for
 *  art-based sets. */
export interface CardFace {
  corner?: string; // small label in the corners, e.g. "A♠"
  center?: string; // large center content, e.g. "♠"
  title?: string; // card name across the top
  body?: string; // rule text in the middle
  sub?: string; // bottom line, e.g. cost / type
  color?: string;
  image?: string;
}

// ---- Mats (SPEC §10) --------------------------------------------------

/** Who may see something: everyone, the mat's owner, or an explicit list
 *  ([] = nobody). */
export type VisibilityRule = 'public' | 'owner' | string[];

export interface MatVisibility {
  faces: VisibilityRule; // fronts of contained cards
  count: VisibilityRule; // how many items it holds (advanced)
  existence: VisibilityRule; // whether the mat renders at all (advanced)
}

export interface SlotDef {
  id: string;
  x: number;
  y: number;
  /** rotation applied to items snapped here (roads on hex edges) */
  rot?: number;
  /** restrict what may snap here (matches item config.tags); empty = anything */
  accepts?: string[];
}

/** Declarative slot graph (v4 §7): expanded into `slots` when the mat is
 *  created, so peers/saves/ops only ever see the concrete list. */
export interface SlotGenerate {
  kind: 'hexgrid' | 'squaregrid';
  /** hexgrid: rings around the center (2 = the 19-hex Catan island) */
  radius?: number;
  /** squaregrid: cell counts */
  rows?: number;
  cols?: number;
  /** cell spacing (hex size / square edge) */
  size: number;
  /** `accepts` per slot class; omit a class to skip those slots */
  classes?: { cell?: string[]; vertex?: string[]; edge?: string[] };
}

export interface MatPlacement {
  type: 'free' | 'grid' | 'slots' | 'stack' | 'fan';
  grid?: { size: number; hex?: boolean }; // hex: staggered hex-center lattice
  slots?: SlotDef[];
  /** authoring shorthand; makeMat expands it into `slots` */
  generate?: SlotGenerate;
}

/** Non-owner presentation of a private mat (SPEC §15): a preset layer over
 *  the faces/count/existence spectrum, which remains underneath for gamebox
 *  authors. 'backs' shows the pile/fan of backs, 'count' just a count chip,
 *  'nothing' hides the mat entirely. */
export type MatPrivacy = 'public' | 'backs' | 'count' | 'nothing';

// ---- macros (SPEC §15: repeatable motions are configuration) -------------

/** Item filter for macro steps (v4 §8): all given fields must match. */
export interface MacroWhere {
  kind?: EntityKind;
  title?: string; // card front title
  tag?: string; // token tag
}

/** One motion in a macro. `from`/`to` name a mat by label, or a mat GROUP:
 *  'hands' is built in (the connected players' hands); templates tag mats
 *  into other groups via `config.groups`. 'table' means loose on the felt. */
export interface MacroStep {
  op: 'deal' | 'gather' | 'shuffle' | 'move' | 'flip' | 'deal-to-slots';
  from?: string; // source mat label; gather/move/flip: group | 'table' | label
  to?: string; // deal: target group; gather/move/deal-to-slots: mat label
  n?: number; // deal: cards per hand (default 1)
  face?: 'up' | 'down'; // flip: target face (omit = toggle)
  where?: MacroWhere; // gather/move/flip: which items
}

/** A template-defined quick action ("deal 5 to hands", "reset") — carried on
 *  the root mat's config and surfaced through the action registry. */
export interface MacroDef {
  id: string;
  label: string;
  steps: MacroStep[];
}

/** How a viewer renders a mat — local preference, never synced (SPEC §11).
 *  'fit' (region mats): the outline shrink-wraps the contents (v4 §2). */
export type ViewMode = 'auto' | 'stack' | 'fan' | 'collapsed' | 'fit';

/** The one container: deck, discard, hand, zone, and board are all mats. */
export type MatEntity = Base<
  'mat',
  {
    label: string;
    /** keyboard-target letter; null = auto-assigned deterministically */
    letter: string | null;
    ownerId: string | null;
    placement: MatPlacement;
    /** applied to cards when they ENTER the mat (never while moving within) */
    faceDefault: 'up' | 'down' | 'keep';
    visibility: MatVisibility;
    /** the preset the visibility spectrum was last set from (drives the
     *  non-owner rendering: backs vs count chip) */
    privacy?: MatPrivacy;
    image: string | null;
    /** surface tint for region mats (and the felt, on the root mat) */
    color?: string | null;
    /** extent for free/grid/slots mats; null for stack/fan (auto-size) */
    size: { w: number; h: number } | null;
    /** group names this mat belongs to, for macro targets ('hands' is
     *  implicit — every connected player's hand) */
    groups?: string[];
    /** template-defined quick actions; meaningful on the root mat */
    macros?: MacroDef[];
    /** which kinds render stacked in stack view; others sit loose at their
     *  own positions on the mat (v4 §2). Default: everything stacks. */
    stackKinds?: EntityKind[];
    /** show the sum of this named value over contained items (v4 §4) */
    showSum?: string;
    /** always-visible buttons on the mat's edge (v4 §5): registry action
     *  ids, compound ids (roll-all-dice, flip-all-cards), or macro:<id> */
    buttons?: Array<{ label?: string; action: string }>;
    /** double-click runs the first entry, ⌥-double-click the second
     *  (v4 §9); falls back to the platform default per kind */
    quickActions?: string[];
    /** 'infinite' (v4 §6): pulls CLONE the top item, returns DESTROY the
     *  returned item, and the count badge renders ∞ */
    supply?: 'normal' | 'infinite';
  },
  {
    /** stack/fan order, index 0 = top; membership authority is child.parent */
    order: string[];
  }
>;

// ---- Items ------------------------------------------------------------

export type TokenEntity = Base<
  'token',
  {
    shape: 'disc' | 'square' | 'hex' | 'bar'; // bar = road-like piece (rotatable)
    color: string;
    label: string;
    size: number;
    /** matched against slot `accepts` when snapping (e.g. "building", "road") */
    tags?: string[];
    /** named numeric values (chips: { value: 5 }); stacks show sums (v4 §4) */
    values?: Record<string, number>;
  },
  { count: number } // a stack of identical pieces; 1 = a single token
>;

export type NoteEntity = Base<
  'note',
  { color: string; w?: number; h?: number }, // size optional: default 140×90
  { text: string }
>;

export type CardEntity = Base<
  'card',
  {
    front: CardFace;
    back: CardFace;
    w: number;
    h: number;
    /** named numeric values (cost, strength…); mats can show sums (v4 §4) */
    values?: Record<string, number>;
  },
  { faceUp: boolean }
>;

/** ONE die — multiplicity is containment ("2d6" = two dice in a tray mat,
 *  v4 §4). state.values stays an array for save compatibility; new dice
 *  hold exactly one value. */
export type DiceEntity = Base<
  'dice',
  { sides: number },
  { values: number[]; rolledBy: string | null; rolledAt: number }
>;

export type CounterEntity = Base<'counter', { label: string }, { value: number }>;

/** One row per player; anyone can adjust any row (SPEC §3). */
export type ScoreboardEntity = Base<
  'scoreboard',
  { label: string },
  { values: Record<string, number> } // playerId -> score
>;

export type TimerEntity = Base<
  'timer',
  Record<string, never>,
  {
    mode: 'stopwatch' | 'countdown';
    running: boolean;
    /** epoch ms when last started; meaningful while running */
    startedAt: number;
    /** accumulated ms while paused */
    elapsedMs: number;
    /** countdown length */
    durationMs: number;
  }
>;

export type Entity =
  | MatEntity
  | TokenEntity
  | NoteEntity
  | CardEntity
  | DiceEntity
  | CounterEntity
  | ScoreboardEntity
  | TimerEntity;

export type EntityKind = Entity['kind'];

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 13)}`;
}
