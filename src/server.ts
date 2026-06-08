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

const messageSync = 0;
const messageAwareness = 1;

type Room = {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Set<WebSocket>;
};

const rooms = new Map<string, Room>();

function getOrCreateRoom(name: string): Room {
  const existing = rooms.get(name);
  if (existing) return existing;

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // server has no awareness state of its own

  const room: Room = { doc, awareness, connections: new Set() };
  rooms.set(name, room);

  // 1. doc.on("update", (update, origin) => ...)
  //    → build encoder: writeVarUint(messageSync), syncProtocol.writeUpdate(encoder, update)
  //    → broadcast(room, message, origin instanceof WebSocket ? origin : undefined)

  doc.on("update", (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    broadcast(room, message, origin instanceof WebSocket ? origin : undefined);
  });

  // 2. awareness.on("update", ({ added, updated, removed }, origin) => ...)
  //    → changedClients = [...added, ...updated, ...removed]
  //    → build encoder: writeVarUint(messageAwareness), then writeVarUint8Array of
  //      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
  //    → broadcast(room, message)   // typically includes the originator

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

wss.on("connection", (ws, req) => {
  const roomName = req.url?.split("/")[1] || "default";
  const room = getOrCreateRoom(roomName);
  room.connections.add(ws);

  // track awareness clientIDs this socket owns, so we can clean them up on disconnect
  const controlledIds = new Set<number>();

  // 5. Send initial sync step 1 to the new client
  //    → encoder: writeVarUint(messageSync), syncProtocol.writeSyncStep1(encoder, room.doc)
  //    → send(ws, encoding.toUint8Array(encoder))
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  send(ws, encoding.toUint8Array(encoder));

  // 6. If room.awareness.getStates().size > 0, send current awareness to the new client
  //    → encoder: writeVarUint(messageAwareness),
  //                writeVarUint8Array of encodeAwarenessUpdate(awareness, [...states.keys()])
  //    → send(ws, ...)
  if (room.awareness.getStates().size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      room.awareness,
      [...room.awareness.getStates().keys()],
    );
    encoding.writeVarUint8Array(encoder, awarenessUpdate);
    send(ws, encoding.toUint8Array(encoder));
  }

  ws.on("message", (data) => {
    // 7. Convert Buffer → Uint8Array:
    //    const bytes = new Uint8Array(data as Buffer)
    //    (be careful if you used { binaryType: "arraybuffer" } anywhere — different conversion)
    const bytes = new Uint8Array(data as Buffer);
    // 8. const decoder = decoding.createDecoder(bytes)
    const decoder = decoding.createDecoder(bytes);
    const messageType = decoding.readVarUint(decoder);
    // 9. switch (messageType) {
    //      case messageSync: {
    //        const responseEncoder = encoding.createEncoder()
    //        encoding.writeVarUint(responseEncoder, messageSync)
    //        syncProtocol.readSyncMessage(decoder, responseEncoder, room.doc, ws)
    //        if (encoding.length(responseEncoder) > 1) {
    //          send(ws, encoding.toUint8Array(responseEncoder))
    //        }
    //        break
    //      }
    //      case messageAwareness: {
    //        const payload = decoding.readVarUint8Array(decoder)
    //        // track the clientIDs this socket controls (read them from the payload
    //        // OR just trust the awareness change handler to attribute via origin=ws)
    //        awarenessProtocol.applyAwarenessUpdate(room.awareness, payload, ws)
    //        break
    //      }
    //    }

    switch (messageType) {
      case messageSync: {
        const responseEncoder = encoding.createEncoder();
        encoding.writeVarUint(responseEncoder, messageSync);
        syncProtocol.readSyncMessage(decoder, responseEncoder, room.doc, ws);
        if (encoding.length(responseEncoder) > 1) {
          send(ws, encoding.toUint8Array(responseEncoder));
        }
        break;
      }
      case messageAwareness: {
        const payload = decoding.readVarUint8Array(decoder);
        // track the clientIDs this socket controls so we can remove their
        // awareness state on disconnect. The awareness update payload is:
        // varUint count, then per client { clientID, clock, state(JSON) } —
        // we only need the clientIDs here.
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
  });

  const cleanup = () => {
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      [...controlledIds],
      null,
    );
    room.connections.delete(ws);
    if (room.connections.size === 0) {
      rooms.delete(roomName);
    }
    console.log(`Client disconnected from room ${roomName}`);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);

  console.log(`Client connected to room ${roomName}`);
});

console.log("Listening on ws://localhost:1234");
