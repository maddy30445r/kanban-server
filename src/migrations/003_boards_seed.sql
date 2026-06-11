INSERT INTO boards (id, name, owner_id) VALUES ('maddy-demo', 'Maddy Demo (legacy)', 'maddy')
  ON CONFLICT DO NOTHING;
INSERT INTO board_members (board_id, user_id) VALUES
  ('maddy-demo', 'maddy'),
  ('maddy-demo', 'shivam')
  ON CONFLICT DO NOTHING;