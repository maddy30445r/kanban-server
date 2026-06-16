import http from "http";
import { USERS, signToken } from "./auth.js";
import { listBoardsForUser } from "./board.js";
import { verifyToken, userExists, getUserPublic } from "./auth.js";
import {
  createBoard,
  getBoard,
  listMembers,
  addMember,
  removeMember,
  isMember,
} from "./board.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.FRONTEND_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST,DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function getUserId(req: http.IncomingMessage): string | null {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return verifyToken(authHeader.slice("Bearer ".length)).sub;
  } catch {
    return null;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

export function handleAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  // Health check — keep-alive pingers hit this. No auth, no DB query.
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/login") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { username, password } = JSON.parse(body);
          const user = USERS[username];
          if (!user || user.password !== password) {
            res.writeHead(401, {
              "Content-Type": "application/json",
              ...corsHeaders,
            });
            res.end(JSON.stringify({ error: "invalid credentials" }));
            return;
          }
          const token = signToken({
            sub: username,
            name: user.name,
            color: user.color,
          });
          res.writeHead(200, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(JSON.stringify({ token }));
        } catch {
          res.writeHead(400, corsHeaders);
          res.end("bad request");
        }
      });
      return;
    }

    if (req.method == "GET" && req.url === "/boards") {
      const authHeader = req.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          ...corsHeaders,
        });
        res.end(JSON.stringify({ error: "missing token" }));
        return;
      }
      const token = authHeader.slice("Bearer ".length);
      let userId: string;
      try {
        userId = verifyToken(token).sub;
      } catch {
        res.writeHead(401, {
          "Content-Type": "application/json",
          ...corsHeaders,
        });
        res.end(JSON.stringify({ error: "invalid token" }));
        return;
      }
      listBoardsForUser(userId)
        .then((boards) => {
          res.writeHead(200, {
            "Content-Type": "application/json",
            ...corsHeaders,
          });
          res.end(JSON.stringify({ boards }));
        })
        .catch((err) => {
          console.error("listBoardsForUser failed:", err);
          res.writeHead(500, corsHeaders);
          res.end("internal error");
        });
      return;
    }

    if (req.method == "POST" && req.url == "/boards") {
      const userId = getUserId(req);
      if (!userId) return sendJson(res, 401, { error: "unauthorized" });
      readJsonBody(req)
        .then(async (body) => {
          const name = (body.name ?? "").toString().trim();
          if (!name) return sendJson(res, 400, { error: "name required" });
          const board = await createBoard(name, userId); // owner + first member, atomic
          sendJson(res, 201, { board });
        })
        .catch((e) => {
          console.error("create board failed:", e);
          sendJson(res, 500, { error: "internal error" });
        });
      return;
    }
    // --- routes under /boards/:id/members ---
    // Path has params now, so parse instead of exact-matching.
    const url = new URL(req.url!, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["boards", id, "members", userId?]
    if (parts[0] === "boards" && parts[2] === "members") {
      const boardId = parts[1];
      const userId = getUserId(req);
      if (!userId) return sendJson(res, 401, { error: "unauthorized" }); // auth once for all 3

      // GET /boards/:id/members — any MEMBER may view
      if (req.method === "GET" && parts.length === 3) {
        (async () => {
          if (!(await isMember(boardId!, userId))) {
            return sendJson(res, 403, { error: "not a member" });
          }
          const members = await listMembers(boardId!);
          // decorate bare user_ids with display names from the user table
          const decorated = members.map((m) => ({
            ...m,
            name: getUserPublic(m.user_id)?.name ?? m.user_id,
          }));
          const board = await getBoard(boardId!);
          sendJson(res, 200, {
            members: decorated,
            ownerId: board?.owner_id ?? null,
          });
        })().catch((e) => {
          console.error("list members failed:", e);
          sendJson(res, 500, { error: "internal error" });
        });
        return;
      }

      // POST /boards/:id/members — OWNER only, add by username
      if (req.method === "POST" && parts.length === 3) {
        readJsonBody(req)
          .then(async (body) => {
            const board = await getBoard(boardId!);
            if (!board) return sendJson(res, 404, { error: "board not found" });
            if (board.owner_id !== userId) {
              return sendJson(res, 403, {
                error: "only the owner can add members",
              });
            }
            const username = (body.username ?? "").toString().trim();
            if (!username)
              return sendJson(res, 400, { error: "username required" });
            if (!userExists(username)) {
              return sendJson(res, 404, { error: "no such user" });
            }
            await addMember(boardId!, username);
            sendJson(res, 200, { ok: true });
          })
          .catch((e) => {
            console.error("add member failed:", e);
            sendJson(res, 500, { error: "internal error" });
          });
        return;
      }

      // DELETE /boards/:id/members/:userId — OWNER only
      if (req.method === "DELETE" && parts.length === 4) {
        const targetUser = parts[3];
        (async () => {
          const board = await getBoard(boardId!);
          if (!board) return sendJson(res, 404, { error: "board not found" });
          if (board.owner_id !== userId) {
            return sendJson(res, 403, {
              error: "only the owner can remove members",
            });
          }
          if (targetUser === board.owner_id) {
            // covers both "remove the owner" and "owner removes self" — prevents orphaning
            return sendJson(res, 400, { error: "cannot remove the owner" });
          }
          await removeMember(boardId!, targetUser!);
          sendJson(res, 200, { ok: true });
        })().catch((e) => {
          console.error("remove member failed:", e);
          sendJson(res, 500, { error: "internal error" });
        });
        return;
      }
    }

    res.writeHead(404, corsHeaders);
    res.end();
  }
}
