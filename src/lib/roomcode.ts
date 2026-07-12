import { randInt } from './model/rng';

const ADJ = ['swift', 'amber', 'lucky', 'velvet', 'copper', 'merry', 'dusty', 'bold', 'quiet', 'wild', 'sly', 'grand'];
const NOUN = ['otter', 'raven', 'fox', 'walrus', 'heron', 'badger', 'lynx', 'mole', 'ibex', 'crane', 'newt', 'stoat'];

export function newRoomCode(): string {
  return `${ADJ[randInt(ADJ.length)]}-${NOUN[randInt(NOUN.length)]}-${randInt(90) + 10}`;
}

export function parseHash(): { room: string | null; page: 'help' | null } {
  if (/^#\/help\b/.test(location.hash)) return { room: null, page: 'help' };
  const m = location.hash.match(/^#\/t\/([\w-]+)/);
  return { room: m ? m[1] : null, page: null };
}

export function inviteLink(room: string): string {
  return `${location.origin}${location.pathname}#/t/${room}`;
}
