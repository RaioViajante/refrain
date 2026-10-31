// Runs before every unit-test file. Unit tests never touch a database, so the
// connection strings that vitest.config.mts loads from .env are removed: a
// unit test that reached getDb() by mistake fails instead of connecting to the
// development database.
delete process.env.DATABASE_URL;
delete process.env.TEST_DATABASE_URL;

// node-postgres falls back to these for anything a connection string omits.
// Removing them keeps the unit tests of the test-database checks deterministic.
for (const variable of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER"]) {
  delete process.env[variable];
}
