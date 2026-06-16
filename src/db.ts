import { Pool } from "pg";

// Single shared pool for the whole process. Both the WS server (membership
// check + persistence) and the login server (GET /boards) import this `pg`,
// so there's exactly one pool, not one per module.
export const pg = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Managed Postgres requires SSL; local Docker Postgres does not. Keying off
  // the host keeps dev and prod on one code path.
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// Connectivity check runs once, when this module is first imported.
pg.query("SELECT 1")
  .then(() => console.log("pg connected"))
  .catch((err) => console.error("pg connection failed:", err));
