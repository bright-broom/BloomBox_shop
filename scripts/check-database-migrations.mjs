import { loadMigrations } from "./lib/database-migrations.mjs";
import { resolve } from "node:path";

const migrations = await loadMigrations(resolve(process.cwd(), "database/migrations"));

for (let index = 0; index < migrations.length; index += 1) {
  const expectedVersion = String(index + 1).padStart(4, "0");
  if (migrations[index].version !== expectedVersion) {
    throw new Error(
      `Migration sequence must be contiguous. Expected ${expectedVersion}, received ${migrations[index].version}`,
    );
  }
}

console.log(`${migrations.length} database migration(s) are ordered and checksummed.`);
