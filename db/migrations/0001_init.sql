-- 0001_init: foundational database setup only. No domain tables yet.
--
-- pgcrypto provides gen_random_uuid(), which later migrations will use for
-- primary keys. Enabling it here keeps that infrastructure decision in one
-- place and makes this migration idempotent on its own.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
