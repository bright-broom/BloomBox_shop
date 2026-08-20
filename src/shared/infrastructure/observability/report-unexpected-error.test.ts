import { describe, expect, it, vi } from "vitest";
import { reportUnexpectedError } from "./report-unexpected-error";

describe("reportUnexpectedError", () => {
  it("creates a correlation ID without logging the sensitive error message", () => {
    const logger = { error: vi.fn() };
    const errorId = reportUnexpectedError(
      new Error("recipient@example.com secret gift message"),
      { operation: "create_order" },
      logger,
    );

    expect(errorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.error).toHaveBeenCalledOnce();
    const record = logger.error.mock.calls[0][0];
    expect(record).toContain('"operation":"create_order"');
    expect(record).toContain(`"errorId":"${errorId}"`);
    expect(record).not.toContain("recipient@example.com");
    expect(record).not.toContain("secret gift message");
  });
});
