import { readFile } from "node:fs/promises";

const stylePath = "src/app/globals.css";
const source = await readFile(stylePath, "utf8");
const rootMatch = source.match(/:root\s*\{[\s\S]*?\n\}/);

if (!rootMatch) {
  console.error(`${stylePath}: missing :root design token block`);
  process.exit(1);
}

const componentStyles = source.replace(rootMatch[0], "");
const violations = [];

for (const match of componentStyles.matchAll(/#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([^)]*\)/g)) {
  violations.push(`${stylePath}: raw color ${match[0]} must be a semantic token in :root`);
}

for (const match of componentStyles.matchAll(/(?:color|background(?:-color)?)\s*:\s*(white|black|red)\b/g)) {
  violations.push(`${stylePath}: named color ${match[1]} must be a semantic token in :root`);
}

const requiredTokens = [
  "--ink",
  "--paper",
  "--coral",
  "--positive",
  "--danger",
  "--font-sans",
  "--font-serif",
];
for (const token of requiredTokens) {
  if (!rootMatch[0].includes(`${token}:`)) violations.push(`${stylePath}: missing required token ${token}`);
}

if (violations.length) {
  console.error("Design token violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Design tokens are valid.");
}
