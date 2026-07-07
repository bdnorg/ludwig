// P2P networking over Trystero (WebRTC; signaling over public Nostr relays,
// Trystero's maintained default — swap the import for another strategy
// package, e.g. @trystero-p2p/torrent or @trystero-p2p/mqtt, to change it).
// Full mesh; no sequencer and no host. When two peers meet, each sends the
// other a hello (profile) and a full snapshot; snapshot merge is LWW and
// idempotent, so this symmetric exchange replaces host election entirely
// (a returning peer's saved state also reconciles this way).

import { joinRoom, type DataPayload, type Room } from 'trystero';
import type { PlayerInfo } from '../model/types';
import type { Mutation, TableState } from '../model/reducers';
import type { NetLink, TableStore } from '../state/store.svelte';

const APP_ID = 'ludwig-v0';

/** Typed wrapper over a trystero message action. Our payloads are all plain
 *  JSON (SPEC §5) but are typed as interfaces, hence the DataPayload casts. */
function action<T>(
  room: Room,
  name: string,
  onMessage: (data: T, peerId: string) => void,
): (data: T, target?: string) => void {
  const a = room.makeAction(name);
  a.onMessage = (data, ctx) => onMessage(data as T, ctx.peerId);
  return (data, target) => {
    void a.send(data as unknown as DataPayload, target ? { target } : undefined);
  };
}

export function connect(store: TableStore, roomCode: string): NetLink {
  const room = joinRoom({ appId: APP_ID }, roomCode);

  const sendHello = action<PlayerInfo>(room, 'hello', (player, peerId) => {
    store.peers[peerId] = player.id;
    store.players[player.id] = player;
  });

  const sendMuts = action<Mutation[]>(room, 'muts', (muts) => store.receive(muts));

  const sendSnap = action<TableState>(room, 'snap', (snap) => store.receiveSnapshot(snap));

  const sendDrag = action<{ id: string; x: number; y: number }>(room, 'drag', ({ id, x, y }) => {
    store.dragPos[id] = { x, y };
  });

  const sendPtr = action<{ x: number; y: number }>(room, 'ptr', ({ x, y }, peerId) => {
    const playerId = store.peers[peerId];
    if (playerId) store.pointers[peerId] = { x, y, playerId };
  });

  room.onPeerJoin = (peerId) => {
    sendHello(store.profile(), peerId);
    sendSnap(store.snapshot(), peerId);
  };

  room.onPeerLeave = (peerId) => {
    delete store.peers[peerId];
    delete store.pointers[peerId];
  };

  const link: NetLink = {
    sendMuts: (muts) => sendMuts(muts),
    sendDrag: (id, x, y) => sendDrag({ id, x, y }),
    sendPointer: throttle((x: number, y: number) => sendPtr({ x, y }), 50),
    sendProfile: () => sendHello(store.profile()),
    broadcastSnapshot: () => sendSnap(store.snapshot()),
    leave: () => void room.leave(),
  };
  store.net = link;
  return link;
}

function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let queued: A | null = null;
  return (...args: A) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!queued) {
      queued = args;
      setTimeout(
        () => {
          last = Date.now();
          const a = queued!;
          queued = null;
          fn(...a);
        },
        ms - (now - last),
      );
    } else {
      queued = args;
    }
  };
}
