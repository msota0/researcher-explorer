-- Idempotent creation of the application role + database.
-- Run as a Postgres superuser, connected to the default `postgres` database:
--
--   psql -U postgres -d postgres \
--        -v app_user=rex -v app_password=CHANGE_ME -v app_db=researcher_explorer \
--        -f init_db.sql
--
-- Safe to run repeatedly: it only creates what is missing. The pg_trgm extension
-- is created inside the app database by the Alembic migration, not here.

\set ON_ERROR_STOP on

-- Create the login role if it does not already exist.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

-- Create the database owned by that role if it does not already exist.
-- (CREATE DATABASE cannot run inside a transaction/DO block, hence \gexec.)
SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db')
\gexec
