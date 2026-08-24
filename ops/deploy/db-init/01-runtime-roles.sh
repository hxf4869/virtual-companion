#!/bin/bash
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${VC_RUNTIME_DB_PASSWORD:?VC_RUNTIME_DB_PASSWORD is required}"
: "${VC_MIGRATOR_DB_PASSWORD:?VC_MIGRATOR_DB_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=runtime_password="$VC_RUNTIME_DB_PASSWORD" \
  --set=migrator_password="$VC_MIGRATOR_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE vc_migrator LOGIN SUPERUSER CREATEDB CREATEROLE BYPASSRLS PASSWORD %L',
  :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_migrator')
\gexec
ALTER ROLE vc_migrator LOGIN SUPERUSER CREATEDB CREATEROLE BYPASSRLS
  PASSWORD :'migrator_password';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_api') THEN
    CREATE ROLE vc_api NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_worker') THEN
    CREATE ROLE vc_worker NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_job_coordinator') THEN
    CREATE ROLE vc_job_coordinator NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_dispatcher') THEN
    CREATE ROLE vc_dispatcher NOLOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

SELECT format(
  'CREATE ROLE vc_runtime_login LOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD %L',
  :'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_runtime_login')
\gexec

ALTER ROLE vc_runtime_login
  LOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS
  PASSWORD :'runtime_password';
GRANT vc_api, vc_worker, vc_job_coordinator, vc_dispatcher TO vc_runtime_login;
SQL
