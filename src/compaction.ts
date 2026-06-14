import * as Y from "yjs";
import { pg } from "./db.js";

export async function compactRoom(roomName: string, doc: Y.Doc): Promise<void> {
  // 1. High-water mark: "everything <= this id, I'm about to capture."
  const maxRes = await pg.query(
    "SELECT COALESCE(MAX(id), 0) AS max_id FROM document_updates WHERE room_name = $1",
    [roomName],
  );
  // node-postgres returns BIGINT as a string. COALESCE(...,0) gives "0" when the
  // room has no rows yet — nothing to compact, so bail.
  const maxId: string = maxRes.rows[0].max_id;
  if (maxId === "0") return;

  // 2. Full-state snapshot of the CURRENT in-memory doc. Taken after reading
  //    maxId, so it's a superset of everything <= maxId (and maybe a bit more).
  const snapshot = Y.encodeStateAsUpdate(doc);

  // 3. Atomic: write the snapshot row (fresh higher id), then drop superseded
  //    rows. One transaction => both commit or neither; a crash can't leave the
  //    deletes applied without the snapshot present.
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO document_updates (room_name, update_blob, type) VALUES ($1, $2, 'snapshot')",
      [roomName, Buffer.from(snapshot)],
    );
    await client.query(
      "DELETE FROM document_updates WHERE room_name = $1 AND id <= $2",
      [roomName, maxId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release(); // always return the client to the pool
  }
}

// Cheap row count for the threshold trigger. ::int casts BIGINT count down to a
// JS number (a room will never have 2^31 rows, so this is safe).
export async function countRoomRows(roomName: string): Promise<number> {
  const res = await pg.query(
    "SELECT COUNT(*)::int AS n FROM document_updates WHERE room_name = $1",
    [roomName],
  );
  return res.rows[0].n;
}
