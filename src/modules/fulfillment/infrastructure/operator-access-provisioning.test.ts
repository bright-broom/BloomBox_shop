import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { provisionOperatorAccess } from "./operator-access-provisioning";

const value = { changeId: randomUUID(), database: "bloombox_test", kind: "APPROVER", permissionId: randomUUID(), operatorId: randomUUID(),
  shop: "example.myshopify.com", expectedVersion: 0, enabled: true, validUntil: "2099-01-01T00:00:00.000Z", reason: "INITIAL_ASSIGNMENT" };
describe("operator provisioning input and CLI boundary", () => {
  it.each([{ kind: "owner" }, { operatorId: "email@example.com" }, { changeId: "not-a-uuid" }, { database: "wrong/database" },
    { shop: "example.com" }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: "1" },
    { expectedVersion: Number.MAX_SAFE_INTEGER }, { enabled: "true" }, { validUntil: "invalid" },
    { validUntil: "2099-01-01T00:00:00" }, { reason: "private notes" }, { actorId: randomUUID() }])
    ("rejects untrusted input before initializing a transaction: %j", async (patch) => {
      const sql = postgres("postgres://127.0.0.1:1/test_unreachable", { max: 1, connect_timeout: 1 });
      const begin = vi.spyOn(sql, "begin");
      try {
        await expect(provisionOperatorAccess(sql, { ...value, ...patch })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        expect(begin).not.toHaveBeenCalled();
      } finally { await sql.end(); }
    });
  it("rejects accidental apply flags, missing admin configuration, insecure remote TLS, oversized/invalid files without disclosing inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bloombox-provisioning-invalid-")); const file = join(directory, "request.json");
    const marker = "PRIVATE-REQUEST-CONTENT";
    const baseline = { ...process.env, DATABASE_OPERATOR_ADMIN_URL: "postgres://synthetic:PRIVATE-PASSWORD@127.0.0.1:1/test_unreachable", DATABASE_SSL_MODE: "disable" };
    async function rejected(env = baseline, args: string[] = []) {
      try { await promisify(execFile)(process.execPath, ["scripts/provision-operator-access.mjs", file, ...args], { env }); }
      catch (error) {
        if (!(error instanceof Error) || !("stderr" in error) || !("stdout" in error)) throw error;
        expect(error.stdout).toBe("");
        expect(String(error.stderr)).toMatch(/Operator access provisioning: (INVALID_REQUEST|UNAVAILABLE)/);
        expect(String(error.stderr)).not.toMatch(/PRIVATE-REQUEST-CONTENT|PRIVATE-PASSWORD/);
        return;
      }
      throw new Error("Expected safe CLI rejection");
    }
    try {
      await writeFile(file, JSON.stringify(value));
      await rejected(baseline, ["--apply"]);
      await rejected(baseline, [`--apply=${"0".repeat(64)}`, "extra"]);
      await rejected({ ...baseline, DATABASE_OPERATOR_ADMIN_URL: "" });
      await rejected({ ...baseline, DATABASE_OPERATOR_ADMIN_URL: "postgres://synthetic:PRIVATE-PASSWORD@remote.example/test" });
      await rejected({ ...baseline, DATABASE_SSL_MODE: "require" });
      await writeFile(file, marker); await rejected();
      await writeFile(file, JSON.stringify({ ...value, marker }) + " ".repeat(16_384)); await rejected();
    } finally { await rm(directory, { recursive: true }); }
  });
});
