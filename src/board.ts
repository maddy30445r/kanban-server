import { pg } from "./db.js";
import { nanoid } from "nanoid";

export async function isMember(boardId: string, userId: string) {
  const res = await pg.query(
    "SELECT 1 FROM board_members where board_id=$1 AND user_id=$2",
    [boardId, userId],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

export type BoardSummary = { id: string; name: string };

export async function listBoardsForUser(userId: string) {
  const res = await pg.query(
    `SELECT b.id , b.name FROM boards b JOIN board_members m on m.board_id=b.id
        WHERE m.user_id=$1 ORDER by b.name`,
    [userId],
  );
  return res.rows;
}
export type BoardDetail = { id: string; name: string; owner_id: string };

export async function getBoard(boardId: string): Promise<BoardDetail | null> {
  const res = await pg.query(
    "SELECT id,name,owner_id FROM boards where id = $1",
    [boardId],
  );
  return res.rows[0] ?? null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // any run of non-alphanumerics -> single dash
    .replace(/^-+|-+$/g, "") // trim leading/trailing dashes
    .slice(0, 32);

  return `${base || "board"}-${nanoid(6)}`;
}

export async function createBoard(
  name: string,
  ownerId: string,
): Promise<BoardDetail> {
  const id = slugify(name);
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO boards (id,name,owner_id) VALUES ($1,$2,$3)",
      [id, name, ownerId],
    );
    await client.query(
      "INSERT INTO board_members (board_id,user_id) VALUES ($1,$2)",
      [id, ownerId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { id, name, owner_id: ownerId };
}

export type Member = { user_id: string; added_at: string };

export async function listMembers(boardId: string): Promise<Member[]> {
  const res = await pg.query(
    "SELECT user_id, added_at FROM board_members WHERE board_id = $1 ORDER BY added_at",
    [boardId],
  );
  return res.rows;
}

export async function addMember(
  boardId: string,
  userId: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO board_members (board_id, user_id) VALUES ($1, $2)
     ON CONFLICT (board_id, user_id) DO NOTHING`,
    [boardId, userId],
  );
}

export async function removeMember(
  boardId: string,
  userId: string,
): Promise<void> {
  await pg.query(
    "DELETE FROM board_members WHERE board_id = $1 AND user_id = $2",
    [boardId, userId],
  );
}
