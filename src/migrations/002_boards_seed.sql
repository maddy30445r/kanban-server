INSERT INTO boards (id, name, owner_id) VALUES
  ('maddy-board',    'Maddy''s Personal Board', 'maddy'),
  ('shared-board',   'Shared Board',            'maddy'),
  ('shivam-private', 'Shivam''s Private Board', 'shivam');

  INSERT INTO board_members (board_id, user_id) VALUES
  ('maddy-board',    'maddy'),
  ('shared-board',   'maddy'),
  ('shared-board',   'shivam'),
  ('shivam-private', 'shivam');