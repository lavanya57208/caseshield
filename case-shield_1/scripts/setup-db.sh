#!/usr/bin/env bash
# Case Shield — local PostgreSQL bootstrap for development.
# Idempotent-ish: safe to re-run: CREATE USER/DATABASE IF NOT EXISTS is not
# supported everywhere, so this checks first.
set -euo pipefail

DB_USER="${CASE_SHIELD_DB_USER:-caseshield}"
DB_PASSWORD="${CASE_SHIELD_DB_PASSWORD:-caseshield_dev_pw}"
DB_NAME="${CASE_SHIELD_DB_NAME:-case_shield_dev}"

echo "Setting up local PostgreSQL role and database for Case Shield..."

psql_superuser() {
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo -u postgres psql -tAc "$1"
  else
    psql -U postgres -tAc "$1"
  fi
}

ROLE_EXISTS=$(psql_superuser "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" || true)
if [ "$ROLE_EXISTS" != "1" ]; then
  psql_superuser "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}' CREATEDB;"
  echo "Created role ${DB_USER}."
else
  echo "Role ${DB_USER} already exists."
fi

DB_EXISTS=$(psql_superuser "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" || true)
if [ "$DB_EXISTS" != "1" ]; then
  psql_superuser "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
  echo "Created database ${DB_NAME}."
else
  echo "Database ${DB_NAME} already exists."
fi

echo "Done. DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
