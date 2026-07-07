// Local player identity, persisted per browser so a refresh rejoins as the
// same player (and reclaims the same hand).

import type { PlayerInfo } from '../model/types';

const KEY = 'ludwig:player';

const COLORS = [
  '#e4573d', '#3d9be4', '#48b265', '#d9a521',
  '#9b59c9', '#e46fa5', '#2fbdb3', '#8a6d4a',
];

export function loadPlayer(): PlayerInfo {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PlayerInfo;
  } catch {
    /* fall through to fresh identity */
  }
  const p: PlayerInfo = {
    id: `p_${crypto.randomUUID().slice(0, 13)}`,
    name: '',
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  localStorage.setItem(KEY, JSON.stringify(p));
  return p;
}

export function savePlayer(p: PlayerInfo): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}
