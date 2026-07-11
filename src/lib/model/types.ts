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
  locked: boolean;
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
  /** restrict what may snap here (matches item config.tags); empty = anything */
  accepts?: string[];
}

export interface MatPlacement {
  type: 'free' | 'grid' | 'slots' | 'stack' | 'fan';
  grid?: { size: number };
  slots?: SlotDef[];
}

/** How a viewer renders a mat — local preference, never synced (SPEC §11). */
export type ViewMode = 'auto' | 'stack' | 'fan' | 'collapsed';

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
    image: string | null;
    /** extent for free/grid/slots mats; null for stack/fan (auto-size) */
    size: { w: number; h: number } | null;
    /** docked mats (hands, the game mat) render in chrome, not on the table */
    docked: boolean;
  },
  {
    /** stack/fan order, index 0 = top; membership authority is child.parent */
    order: string[];
  }
>;

// ---- Items ------------------------------------------------------------

export type TokenEntity = Base<
  'token',
  { shape: 'disc' | 'square'; color: string; label: string; size: number },
  { count: number } // a stack of identical pieces; 1 = a single token
>;

export type NoteEntity = Base<'note', { color: string }, { text: string }>;

export type CardEntity = Base<
  'card',
  { front: CardFace; back: CardFace; w: number; h: number },
  { faceUp: boolean }
>;

export type DiceEntity = Base<
  'dice',
  { sides: number; count: number },
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
