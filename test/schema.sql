DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS hats;

CREATE TABLE hats (
  id serial PRIMARY KEY,
  color text,
  created_at timestamptz,
  data jsonb
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  name text,
  hat_id int REFERENCES hats,
  created_at timestamptz
);




