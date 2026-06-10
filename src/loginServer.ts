import http from "http";
import { USERS, signToken } from "./auth.js";

const PORT = 1235;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
            res.writeHead(401, { "Content-Type": "application/json", ...corsHeaders });
            res.end(JSON.stringify({ error: "invalid credentials" }));
            return;
          }
          const token = signToken({
            sub: username,
            name: user.name,
            color: user.color,
          });
          res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ token }));
        } catch {
          res.writeHead(400, corsHeaders);
          res.end("bad request");
        }
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
