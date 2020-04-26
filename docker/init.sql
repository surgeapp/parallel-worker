CREATE DATABASE "parallel-worker-test";
\c parallel-worker-test
CREATE TABLE users (
  id   SERIAL,
  name CHARACTER VARYING(255) NOT NULL,
  updated NUMERIC
  CONSTRAINT "users_id_pk" PRIMARY KEY (id)
);
