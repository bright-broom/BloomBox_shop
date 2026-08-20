import { loadDatabaseConfig, loadWorkerDatabaseConfig } from "../config/database-config";
import { createPostgresClient, type DatabaseClient } from "./postgres-client";

let applicationClient: DatabaseClient | undefined;
let workerClient: DatabaseClient | undefined;

export function getApplicationDatabaseClient(): DatabaseClient {
  applicationClient ??= createPostgresClient(loadDatabaseConfig());
  return applicationClient;
}

export function getWorkerDatabaseClient(): DatabaseClient {
  workerClient ??= createPostgresClient(loadWorkerDatabaseConfig());
  return workerClient;
}
