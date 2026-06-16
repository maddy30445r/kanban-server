import { readdir, readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import { pg } from "./db.js";

// Applies every src/migrations/*.sql file once, in sorted filename order.
// A schema_migrations table records what's been run, so re-running is a no-op
// — important because the *_seed.sql files would duplicate-key on a second run.
// Run with: npm run migrate (DATABASE_URL must point at the target DB).

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

async function main() {
  await pg.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await pg.query<{ filename: string }>("SELECT filename FROM schema_migrations"))
      .rows.map((r) => r.filename)
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pg.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
      console.log(`apply  ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`failed ${file}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("migrations complete");
  await pg.end();
}

main().catch((err) => {
  console.error("migration run failed:", err);
  process.exit(1);
});
