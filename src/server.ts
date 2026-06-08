import { WebSocketServer, WebSocket } from "ws";

// data structure: roomName → set of connected sockets
const rooms = new Map<string, Set<WebSocket>>();

const wss = new WebSocketServer({ port: 1234 });

wss.on("connection", (ws, req) => {
  // 1. Extract room name from req.url (e.g. "/board-abc" → "board-abc")
  const roomName = req.url?.split("/")[1] || "default";

  // 2. Add ws to rooms[roomName] (create the set if it doesn't exist)
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set<WebSocket>());
  }
  rooms.get(roomName)?.add(ws);

  // 3. On 'message', broadcast to all OTHER sockets in the same room
  ws.on("message", (data) => {
    const message = data.toString();
    const sockets = rooms.get(roomName);
    if (sockets) {
      sockets.forEach((s) => {
        if (s != ws && s.readyState === WebSocket.OPEN) {
          s.send(message);
        }
      });
    }
  });
  // 4. On 'close' AND on 'error', remove ws from the room (and delete the room if empty)
  const cleanup = () => {
    const sockets = rooms.get(roomName);
    if (sockets) {
  console.log(`${ws} Client disconnected from room ${roomName}`);

      sockets.delete(ws);
      if(sockets.size===0){
        rooms.delete(roomName);
      }
    }
  }
ws.on("close", cleanup);
ws.on("error", cleanup);

  // 5. Log connect/disconnect with the room name for visibility

  console.log(`Client connected to room ${roomName}`);
});

console.log("Listening on ws://localhost:1234");
