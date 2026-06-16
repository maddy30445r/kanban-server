CREATE TABLE document_updates (
  id          SERIAL PRIMARY KEY,
  room_name   TEXT NOT NULL,
  update_blob BYTEA NOT NULL
);

CREATE INDEX idx_doc_updates_room ON document_updates (room_name, id);
