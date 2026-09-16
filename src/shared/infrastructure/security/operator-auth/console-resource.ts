import { CustomerManagementError } from "@/modules/customer/public";
export type ConsoleResource<T> =
  | { status: "ready"; value: T }
  | { status: "unbound" | "denied" | "unavailable" | "invalid" };
/** Fixed log code only; never render underlying configuration/database errors. */
export async function consoleResource<T>(
  load: () => Promise<T>,
): Promise<ConsoleResource<T>> {
  try {
    return { status: "ready", value: await load() };
  } catch (error) {
    if (error instanceof CustomerManagementError && error.code === "DENIED")
      return { status: "denied" };
    if (error instanceof CustomerManagementError && error.code === "INVALID")
      return { status: "invalid" };
    console.error("operations_console_read_unavailable");
    return { status: "unavailable" };
  }
}
