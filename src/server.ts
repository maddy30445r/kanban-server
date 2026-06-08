// import { WebSocketServer, WebSocket } from "ws";

// // data structure: roomName → set of connected sockets
// const rooms = new Map<string, Set<WebSocket>>();

// const wss = new WebSocketServer({ port: 1234 });

// wss.on("connection", (ws, req) => {
//   // 1. Extract room name from req.url (e.g. "/board-abc" → "board-abc")
//   const roomName = req.url?.split("/")[1] || "default";

//   // 2. Add ws to rooms[roomName] (create the set if it doesn't exist)
//   if (!rooms.has(roomName)) {
//     rooms.set(roomName, new Set<WebSocket>());
//   }
//   rooms.get(roomName)?.add(ws);

//   // 3. On 'message', broadcast to all OTHER sockets in the same room
//   ws.on("message", (data) => {
//     const message = data.toString();
//     const sockets = rooms.get(roomName);
//     if (sockets) {
//       sockets.forEach((s) => {
//         if (s != ws && s.readyState === WebSocket.OPEN) {
//           s.send(message);
//         }
//       });
//     }
//   });
//   // 4. On 'close' AND on 'error', remove ws from the room (and delete the room if empty)
//   const cleanup = () => {
//     const sockets = rooms.get(roomName);
//     if (sockets) {
//   console.log(`${ws} Client disconnected from room ${roomName}`);

//       sockets.delete(ws);
//       if(sockets.size===0){
//         rooms.delete(roomName);
//       }
//     }
//   }
// ws.on("close", cleanup);
// ws.on("error", cleanup);

//   // 5. Log connect/disconnect with the room name for visibility

//   console.log(`Client connected to room ${roomName}`);
// });

// console.log("Listening on ws://localhost:1234");

import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { Pool } from "pg";

const messageSync = 0;
const messageAwareness = 1;

type Room = {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Set<WebSocket>;
  // Pending eviction timer, set when the room goes empty. Cleared if a new
  // client connects before it fires (e.g. a refresh reconnecting).
  evictTimer?: NodeJS.Timeout | undefined;
};

// How long a room stays warm in memory after its last client leaves. A refresh
// reconnects within milliseconds, well inside this window, so it never triggers
// an evict→reload (which would race the not-yet-committed persistence INSERTs).
// Only rooms genuinely idle for this long are freed.
const EVICT_DELAY = 30_000;

const rooms = new Map<string, Room>();
const loadingRooms = new Map<string, Promise<Room>>();

const pg = new Pool({
  host: "localhost",
  port: 5432,
  database: "kanban",
  user: "postgres",
  password: "dev",
});

pg.query("SELECT 1")
  .then(() => console.log("pg connected"))
  .catch((err) => console.error("pg connection failed:", err));

async function getOrCreateRoom(name: string): Promise<Room> {
  // 1. Already fully loaded → return it.
  const existing = rooms.get(name);
  if (existing) return existing;

  // 2. Currently loading (another connection got here first) → await the SAME
  //    promise, so everyone shares one Y.Doc instead of racing to build their own.
  const pending = loadingRooms.get(name);
  if (pending) return pending;

  // 3. We're the first → kick off the load and cache the in-flight promise
  //    immediately (synchronously, before any await) so concurrent callers in
  //    step 2 can find it.
  const loadPromise = loadRoom(name);
  loadingRooms.set(name, loadPromise);

  try {
    const room = await loadPromise;
    rooms.set(name, room); // promote to the loaded map
    return room;
  } finally {
    // Either way, this room is no longer "loading".
    loadingRooms.delete(name);
  }
}

async function loadRoom(name: string): Promise<Room> {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // server has no awareness state of its own

  // ---- replay saved updates from Postgres ----
  // This MUST complete (and happen BEFORE attaching the doc.on("update")
  // listener), otherwise each replayed applyUpdate triggers an INSERT and you
  // duplicate the entire history every cold start.
  try {
    const res = await pg.query(
      "SELECT update_blob FROM document_updates WHERE room_name = $1 ORDER BY id",
      [name],
    );
    res.rows.forEach((row) => {
      const buf: Buffer = row.update_blob;
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      Y.applyUpdate(doc, bytes);
    });
    console.log(`Replayed ${res.rowCount} updates for room ${name}`);
  } catch (err) {
    console.error(`Failed to load updates for room ${name}:`, err);
  }

  const room: Room = { doc, awareness, connections: new Set() };

  // 1. doc.on("update", (update, origin) => ...) — attached AFTER replay.
  doc.on("update", (update, origin) => {
    // ---- persist this update ----
    pg.query(
      "INSERT INTO document_updates (room_name, update_blob) VALUES ($1, $2)",
      [name, Buffer.from(update)],
    ).catch((err) =>
      console.error(`Failed to persist update for room ${name}:`, err),
    );

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    broadcast(room, message, origin instanceof WebSocket ? origin : undefined);
  });

  // 2. awareness.on("update", ...) — broadcast presence changes to the room.
  awareness.on(
    "update",
    ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const changedClients = [...added, ...updated, ...removed];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        changedClients,
      );
      encoding.writeVarUint8Array(encoder, awarenessUpdate);
      const message = encoding.toUint8Array(encoder);
      broadcast(room, message); // typically includes the originator
    },
  );

  return room;
}

// --- helpers ---

function send(ws: WebSocket, message: Uint8Array) {
  // 3. Guard ws.readyState === WebSocket.OPEN, then ws.send(message)
  //    Wrap in try/catch — sends can throw on a half-dead socket.
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(message);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  }
}

function broadcast(room: Room, message: Uint8Array, exclude?: WebSocket) {
  // 4. For each ws in room.connections, send(ws, message) unless ws === exclude
  room.connections.forEach((ws) => {
    if (ws !== exclude) {
      send(ws, message);
    }
  });
}

// --- server ---

const wss = new WebSocketServer({ port: 1234 });

wss.on("connection", async (ws, req) => {
  const roomName = req.url?.split("/")[1] || "default";

  // Queue any messages that arrive while we await the room load. The `ws`
  // library does NOT buffer 'message' events that have no listener, so if we
  // attached the real handler only after `await getOrCreateRoom(...)`, the
  // client's initial syncStep1 (sent immediately on connect) would be dropped
  // — and the client would never receive the document. Attaching a queueing
  // listener synchronously, BEFORE the first await, closes that window.
  const earlyMessages: Buffer[] = [];
  const queueHandler = (data: Buffer) => {
    earlyMessages.push(data);
  };
  ws.on("message", queueHandler);

  const room = await getOrCreateRoom(roomName);
  if (ws.readyState !== WebSocket.OPEN) return;

  // Cancel any pending eviction — this room is alive again.
  if (room.evictTimer) {
    clearTimeout(room.evictTimer);
    room.evictTimer = undefined;
  }

  room.connections.add(ws);

  // track awareness clientIDs this socket owns, so we can clean them up on disconnect
  const controlledIds = new Set<number>();

  const handleMessage = (data: Buffer) => {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const messageType = decoding.readVarUint(decoder);
    console.log(`[msg in] type=${messageType} size=${bytes.byteLength}`);

    switch (messageType) {
      case messageSync: {
        const responseEncoder = encoding.createEncoder();
        encoding.writeVarUint(responseEncoder, messageSync);
        syncProtocol.readSyncMessage(decoder, responseEncoder, room.doc, ws);
        const replyLength = encoding.length(responseEncoder);
        console.log(`[sync] reply length=${replyLength}`);
        if (replyLength > 1) {
          send(ws, encoding.toUint8Array(responseEncoder));
        }
        break;
      }
      case messageAwareness: {
        const payload = decoding.readVarUint8Array(decoder);
        // track the clientIDs this socket controls so we can remove their
        // awareness state on disconnect.
        const idDecoder = decoding.createDecoder(payload);
        const count = decoding.readVarUint(idDecoder);
        for (let i = 0; i < count; i++) {
          controlledIds.add(decoding.readVarUint(idDecoder)); // clientID
          decoding.readVarUint(idDecoder); // clock
          decoding.readVarString(idDecoder); // state
        }
        awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, ws);
        break;
      }
    }
  };

  // Swap the queueing listener for the real one, then replay what we buffered.
  ws.off("message", queueHandler);
  ws.on("message", handleMessage);

  // 5. Send initial sync step 1 to the new client.
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  send(ws, encoding.toUint8Array(encoder));

  // 6. If anyone else is present, send current awareness to the new client.
  if (room.awareness.getStates().size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      room.awareness,
      [...room.awareness.getStates().keys()],
    );
    encoding.writeVarUint8Array(awarenessEncoder, awarenessUpdate);
    send(ws, encoding.toUint8Array(awarenessEncoder));
  }

  // Drain anything the client sent during the load (e.g. its syncStep1), so it
  // gets a proper reply now that the room is ready.
  for (const data of earlyMessages) handleMessage(data);
  earlyMessages.length = 0;

  const cleanup = () => {
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      [...controlledIds],
      null,
    );
    room.connections.delete(ws);

    // Don't free the room immediately — a refresh disconnects then reconnects
    // within milliseconds. Schedule eviction after a grace period, and only
    // actually evict if it's still empty when the timer fires.
    if (room.connections.size === 0 && !room.evictTimer) {
      room.evictTimer = setTimeout(() => {
        if (room.connections.size === 0) {
          rooms.delete(roomName);
          room.doc.destroy();
          console.log(`Evicted idle room ${roomName}`);
        }
      }, EVICT_DELAY);
    }

    console.log(`Client disconnected from room ${roomName}`);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);

  console.log(`Client connected to room ${roomName}`);
});

console.log("Listening on ws://localhost:1234");
