import type { Version } from './types';

/** Total order over versions: Lamport clock, actor id as tiebreak. */
export function compareVersions(a: Version, b: Version): number {
  if (a.clock !== b.clock) return a.clock - b.clock;
  return a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0;
}

export function newerThan(a: Version, b: Version | undefined): boolean {
  return b === undefined || compareVersions(a, b) > 0;
}
