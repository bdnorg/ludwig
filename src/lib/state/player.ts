// Player identities are a per-browser roster (SPEC §15.7). The roster lives
// in localStorage; the ACTIVE identity is per-tab (sessionStorage), so two
// tabs can sit at the same table as different players. `ludwig:player`
// remains the "last used" entry — it doubles as the v1 storage key, so old
// browsers (and the integration tests) migrate transparently.

import type { PlayerInfo } from '../model/types';

const ROSTER_KEY = 'ludwig:players';
const LAST_KEY = 'ludwig:player';
const ACTIVE_KEY = 'ludwig:active-player'; // sessionStorage (per-tab)

const COLORS = [
  '#e4573d', '#3d9be4', '#48b265', '#d9a521',
  '#9b59c9', '#e46fa5', '#2fbdb3', '#8a6d4a',
];

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function newPlayer(): PlayerInfo {
  return {
    id: `p_${crypto.randomUUID().slice(0, 13)}`,
    name: '',
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

/** Everyone this browser has played as, last-used first. */
export function listPlayers(): PlayerInfo[] {
  const roster = parse<PlayerInfo[]>(localStorage.getItem(ROSTER_KEY)) ?? [];
  const last = parse<PlayerInfo>(localStorage.getItem(LAST_KEY));
  if (last && !roster.some((p) => p.id === last.id)) roster.unshift(last);
  const lastId = last?.id;
  return roster.sort((a, b) => (a.id === lastId ? -1 : b.id === lastId ? 1 : 0));
}

/** The identity this TAB plays as: the tab's bound player if set, else the
 *  browser's last-used player, else a fresh (not yet persisted) one. */
export function loadPlayer(): PlayerInfo {
  const roster = listPlayers();
  const activeId = sessionStorage.getItem(ACTIVE_KEY);
  const active = roster.find((p) => p.id === activeId);
  if (active) return active;
  return roster[0] ?? newPlayer();
}

/** Pin this tab to an identity WITHOUT touching the browser-wide roster or
 *  last-used — called on table join, so another tab switching players later
 *  can't change who this tab is after a refresh. */
export function bindTab(p: PlayerInfo): void {
  sessionStorage.setItem(ACTIVE_KEY, p.id);
}

/** Upsert into the roster and make this the tab's (and last-used) identity. */
export function savePlayer(p: PlayerInfo): void {
  const roster = parse<PlayerInfo[]>(localStorage.getItem(ROSTER_KEY)) ?? [];
  const i = roster.findIndex((r) => r.id === p.id);
  if (i >= 0) roster[i] = p;
  else roster.unshift(p);
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster.slice(0, 24)));
  localStorage.setItem(LAST_KEY, JSON.stringify(p));
  sessionStorage.setItem(ACTIVE_KEY, p.id);
}
