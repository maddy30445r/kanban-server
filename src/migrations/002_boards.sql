CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE board_members (
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite PK doubles as the index for the authz lookup (board_id, user_id).
  PRIMARY KEY (board_id, user_id)
);
