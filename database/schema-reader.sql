\set ON_ERROR_STOP on

-- Apply separately with the authorized role/table owner, on the intended DB.
-- Does not create a login, password, schema, migration ledger, or business data.
BEGIN;
DO $$
DECLARE
  reader record;
  ledger regclass := to_regclass('bloombox.schema_migrations');
BEGIN
  IF ledger IS NULL THEN
    RAISE EXCEPTION 'Migration ledger is required; no schema reader was provisioned';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bloombox_schema_reader') THEN
    CREATE ROLE bloombox_schema_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  SELECT * INTO reader FROM pg_roles WHERE rolname = 'bloombox_schema_reader';
  IF reader.rolcanlogin OR reader.rolinherit OR reader.rolsuper OR reader.rolcreatedb
    OR reader.rolcreaterole OR reader.rolreplication OR reader.rolbypassrls
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = reader.oid) THEN
    RAISE EXCEPTION 'Schema reader role has unexpected attributes or memberships';
  END IF;
  -- Fail closed on privilege drift instead of silently revoking operator grants.
  IF has_schema_privilege(reader.oid, 'bloombox', 'CREATE')
    OR has_table_privilege(reader.oid, ledger, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(reader.oid, ledger, 'INSERT,UPDATE,REFERENCES')
    OR has_column_privilege(reader.oid, ledger, 'applied_at', 'SELECT')
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'bloombox' AND c.oid <> ledger
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (has_table_privilege(reader.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(reader.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
    ) OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'bloombox' AND c.relkind = 'S'
        AND CASE WHEN c.relkind = 'S'
          THEN has_sequence_privilege(reader.oid, c.oid, 'USAGE,SELECT,UPDATE')
          ELSE false END
    ) THEN
    RAISE EXCEPTION 'Schema reader has unexpected object privileges';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bloombox_schema_reader', current_database());
END
$$;
GRANT USAGE ON SCHEMA bloombox TO bloombox_schema_reader;
GRANT SELECT (version, name, checksum) ON bloombox.schema_migrations TO bloombox_schema_reader;
COMMIT;
