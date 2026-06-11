import http from "http";
import { USERS, signToken } from "./auth.js";
import { verifyToken } from "./auth.js";
import { listBoardsForUser } from "./board.js";

const PORT = 1235;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function startLoginServer() {
  const server = http.createServer((req, res) => {
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

    res.writeHead(404, corsHeaders);
    res.end();
  });

  server.listen(PORT, () => {
    console.log(`Auth server on http://localhost:${PORT}`);
  });

  return server;
}
