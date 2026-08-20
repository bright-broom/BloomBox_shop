import { migrateDatabase } from "./lib/database-migrations.mjs";

const applied = [];
await migrateDatabase({
  databaseUrl: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL_MODE ?? "verify-full",
  onApplied: (migration) => applied.push(migration.fileName),
});

if (applied.length === 0) {
  console.log("Database schema is current.");
} else {
  console.log(`Applied ${applied.length} database migration(s): ${applied.join(", ")}`);
}
