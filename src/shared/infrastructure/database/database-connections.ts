import { loadCatalogManagerDatabaseConfig, loadDatabaseConfig, loadWorkerDatabaseConfig, loadOperatorDatabaseConfig, loadPermissionManagerDatabaseConfig } from "../config/database-config";
import { createPostgresClient, type DatabaseClient } from "./postgres-client";

let applicationClient: DatabaseClient | undefined;
let workerClient: DatabaseClient | undefined;
let operatorClient: DatabaseClient | undefined;
let permissionManagerClient: DatabaseClient | undefined;

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

export function getPermissionManagerDatabaseClient(): DatabaseClient {
  permissionManagerClient ??= createPostgresClient(loadPermissionManagerDatabaseConfig());
  return permissionManagerClient;
}

let catalogManagerClient: DatabaseClient | undefined;
export function getCatalogManagerDatabaseClient(): DatabaseClient {
  catalogManagerClient ??= createPostgresClient(loadCatalogManagerDatabaseConfig());
  return catalogManagerClient;
}
