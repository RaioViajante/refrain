// Runs before every unit-test file. Unit tests never touch a database, so the
// connection strings that vitest.config.mts loads from .env are removed: a
// unit test that reached getDb() by mistake fails instead of connecting to the
// development database.
delete process.env.DATABASE_URL;
delete process.env.TEST_DATABASE_URL;
