import { Pool } from "pg";

// Single shared pool for the whole process. Both the WS server (membership
// check + persistence) and the login server (GET /boards) import this `pg`,
// so there's exactly one pool, not one per module.
export const pg = new Pool({
  host: "localhost",
  port: 5432,
  database: "kanban",
  user: "postgres",
  password: "dev",
});

// Connectivity check runs once, when this module is first imported.
pg.query("SELECT 1")
  .then(() => console.log("pg connected"))
  .catch((err) => console.error("pg connection failed:", err));
