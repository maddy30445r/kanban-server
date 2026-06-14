ALTER TABLE document_updates
  ADD COLUMN type TEXT NOT NULL DEFAULT 'update';

CREATE INDEX idx_doc_updates_room_type
  ON document_updates (room_name, type, id);