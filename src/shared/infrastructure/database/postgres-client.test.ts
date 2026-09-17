import { beforeEach, describe, expect, it, vi } from "vitest";
const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("postgres", () => ({ default: connect }));
import { createPostgresClient } from "./postgres-client";
import { loadDatabaseConfig } from "../config/database-config";

describe("database connection compatibility", () => {
  beforeEach(() => connect.mockClear());
  it("does not add potentially unsupported pooler startup parameters by default", () => {
    createPostgresClient(loadDatabaseConfig({ DATABASE_URL: "postgres://localhost/test" }));
    expect(connect.mock.calls[0][1]).not.toHaveProperty("connection");
    expect(connect.mock.calls[0][1]).toMatchObject({ max: 5, connect_timeout: 10, idle_timeout: 20 });
  });
  it("sends verified timeout settings only after explicit opt-in", () => {
    createPostgresClient(loadDatabaseConfig({ DATABASE_URL: "postgres://localhost/test", DATABASE_CONNECTION_TIMEOUTS_ENABLED: "true" }));
    expect(connect.mock.calls[0][1]).toHaveProperty("connection", {
      statement_timeout: 10_000, lock_timeout: 2_000, idle_in_transaction_session_timeout: 10_000,
    });
  });
});
