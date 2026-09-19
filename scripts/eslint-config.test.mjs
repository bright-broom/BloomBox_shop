import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

// The first lint loads the real project configuration and every plugin, which can exceed the default 5s
// on a loaded machine while the full suite runs in parallel. The rules checked here do not depend on speed.
describe("project ESLint rules after the ESLint 10 migration", { timeout: 30_000 }, () => {
  it("accepts valid TypeScript and JSX using the actual project configuration", async () => {
    const [result] = await eslint.lintText(
      'export function Greeting({ name }: { name: string }) { return <p>Hello {name}</p>; }',
      { filePath: "src/ui/lint-probe.tsx" },
    );
    expect(result.messages).toEqual([]);
  });

  it.each([
    ["react/display-name", "src/ui/lint-probe.tsx", 'export default () => <span>Example</span>;'],
    ["react-hooks/rules-of-hooks", "src/ui/lint-probe.tsx",
      'import { useState } from "react"; export function Example({ enabled }: { enabled: boolean }) { if (enabled) { useState(0); } return <div />; }'],
    ["jsx-a11y/alt-text", "src/ui/lint-probe.tsx", 'export function Example() { return <img src="/example.png" />; }'],
    ["@next/next/no-img-element", "src/ui/lint-probe.tsx", 'export function Example() { return <img src="/example.png" alt="Example" />; }'],
    ["@typescript-eslint/no-explicit-any", "src/ui/lint-probe.ts", 'export const echo = (value: any) => value;'],
    ["import/no-anonymous-default-export", "scripts/lint-probe.mjs", 'export default {};'],
  ])("still detects %s instead of disabling the rule", async (ruleId, filePath, source) => {
    const [result] = await eslint.lintText(source, { filePath });
    expect(result.fatalErrorCount).toBe(0);
    expect(result.messages.some((message) => message.ruleId === ruleId && message.severity > 0)).toBe(true);
  });
});
