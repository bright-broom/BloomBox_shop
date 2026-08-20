import { randomUUID } from "node:crypto";

type ErrorContext = Readonly<{
  operation: string;
}>;

type ErrorLogger = Pick<Console, "error">;

export function reportUnexpectedError(
  error: unknown,
  context: ErrorContext,
  logger: ErrorLogger = console,
): string {
  const errorId = randomUUID();

  logger.error(JSON.stringify({
    event: "unexpected_error",
    errorId,
    errorType: error instanceof Error ? error.name : typeof error,
    operation: context.operation,
    occurredAt: new Date().toISOString(),
  }));

  return errorId;
}
