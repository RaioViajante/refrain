-- Marks the current database as Refrain's disposable integration-test
-- database. The integration tests refuse to run against a database without
-- this marker (src/testing/test-database.ts), so they can never write to the
-- development database or any other database by accident.
--
-- Applied automatically when the local `postgres-test` service initializes
-- (compose.yaml), and by CI to its service container. Never run it against a
-- database whose contents matter.
DO $$
BEGIN
  EXECUTE format(
    'COMMENT ON DATABASE %I IS %L',
    current_database(),
    'refrain:disposable-test-database'
  );
END
$$;
