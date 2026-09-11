import { loadDatabaseConfig, loadWorkerDatabaseConfig, loadOperatorDatabaseConfig } from "../config/database-config";
import { createPostgresClient, type DatabaseClient } from "./postgres-client";

let applicationClient: DatabaseClient | undefined;
let workerClient: DatabaseClient | undefined;
let operatorClient: DatabaseClient | undefined;

export function getApplicationDatabaseClient(): DatabaseClient {
  applicationClient ??= createPostgresClient(loadDatabaseConfig());
  return applicationClient;
}

export function getWorkerDatabaseClient(): DatabaseClient {
  workerClient ??= createPostgresClient(loadWorkerDatabaseConfig());
  return workerClient;
}

export function getOperatorDatabaseClient(): DatabaseClient {
  operatorClient ??= createPostgresClient(loadOperatorDatabaseConfig());
  return operatorClient;
}
