// Core entity model. See SPEC.md §2–3.
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
  /** null = on the table; otherwise the id of a containing entity (deck, hand) */
  parent: string | null;
  /** table coordinates; meaningless while inside a container */
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

export type TokenEntity = Base<
  'token',
  { shape: 'disc' | 'square'; color: string; label: string; size: number },
  { count: number } // a stack of identical pieces; 1 = a single token
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

/** A labeled region. autoFaceDown flips cards face down as they enter. */
export type ZoneEntity = Base<
  'zone',
  { label: string; w: number; h: number; color: string; autoFaceDown: boolean },
  Record<string, never>
>;

export type NoteEntity = Base<'note', { color: string }, { text: string }>;

export type CardEntity = Base<
  'card',
  { front: CardFace; back: CardFace; w: number; h: number },
  { faceUp: boolean }
>;

/** A deck and a discard pile are the same kind with different facePolicy. */
export type DeckEntity = Base<
  'deck',
  { label: string; facePolicy: 'down' | 'up'; w: number; h: number },
  { cards: string[] } // index 0 = top; order authority (membership authority is card.parent)
>;

export type HandEntity = Base<
  'hand',
  { ownerId: string }, // player id, stable across reconnects
  { cards: string[]; revealedTo: string[] | 'all' }
>;

export type Entity =
  | TokenEntity
  | NoteEntity
  | CardEntity
  | DeckEntity
  | HandEntity
  | DiceEntity
  | CounterEntity
  | ScoreboardEntity
  | TimerEntity
  | ZoneEntity;

export type EntityKind = Entity['kind'];

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 13)}`;
}
