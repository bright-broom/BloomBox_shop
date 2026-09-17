import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workflow = (name) => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");

// Run the checked-in GitHub Script with API doubles; no network, tokens, or artifacts.
async function runStep(file, name, records = []) {
  const step = workflow(file).split("      - name: ").find((part) => part.startsWith(`${name}\n`));
  if (!step?.includes("          script: |\n")) throw new Error(`Missing script step: ${name}`);
  const script = step.split("          script: |\n")[1]
    .split("\n").map((line) => line.replace(/^ {12}/, "")).join("\n");
  const issues = Object.fromEntries(["listForRepo", "listComments", "create", "update", "createComment", "updateComment"]
    .map((method) => [method, vi.fn()]));
  const github = { paginate: vi.fn().mockResolvedValue(records), rest: { issues } };
  await runInNewContext(`(async () => {\n${script}\n})()`, {
    github,
    context: {
      serverUrl: "https://github.com", repo: { owner: "example", repo: "shop" }, runId: 123,
      payload: { workflow_run: { name: "CI", head_sha: "a".repeat(40), html_url: "https://github.com/example/shop/actions/runs/123", pull_requests: [{ number: 10 }] } },
    },
    require: (module) => {
      if (module !== "fs") throw new Error(`Unexpected module: ${module}`);
      return { readFileSync: () => JSON.stringify({ attention: { failedInboxEvents: 2, unrecordedCheckoutsAwaitingReview: 1 }, ignored: "private-payload" }) };
    },
    process: { env: { WORKER_RESPONSE: "/fixture/response.json" } },
  });
  return issues;
}

const ownBot = { type: "Bot", login: "github-actions[bot]" };
const foreignAuthors = [
  { type: "User", login: "contributor" },
  { type: "Bot", login: "other-app[bot]" },
  { type: "User", login: "github-actions[bot]" },
];
const incidents = [
  { file: "production-smoke", marker: "<!-- bloombox-production-smoke -->", open: "Open or refresh production incident", close: "Close recovered production incident" },
  { file: "commerce-reconciliation", marker: "<!-- bloombox-commerce-reconciliation -->", open: "Open or refresh reconciliation incident", close: "Close recovered reconciliation incident" },
];

for (const incident of incidents) {
  describe(incident.file, () => {
    const unrelated = () => [
      ...foreignAuthors.map((user, index) => ({ number: index + 1, user, body: incident.marker })),
      { number: 4, user: ownBot, body: incident.marker, pull_request: { url: "https://example.test/pr/4" } },
      { number: 5, user: ownBot, body: "Another workflow's incident" },
      { number: 6, body: incident.marker },
    ];
    it("creates its incident without rewriting contributor issues, other bots, or pull requests", async () => {
      const api = await runStep(incident.file, incident.open, unrelated());
      expect(api.update).not.toHaveBeenCalled();
      expect(api.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ body: expect.stringContaining(incident.marker) }));
      expect(api.create.mock.calls[0][0].body).not.toContain("private-payload");
    });
    it("refreshes the matching Actions bot incident, even after unrelated matching markers", async () => {
      const api = await runStep(incident.file, incident.open, [...unrelated(), { number: 99, user: ownBot, body: incident.marker }]);
      expect(api.create).not.toHaveBeenCalled();
      expect(api.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ issue_number: 99, state: "open" }));
    });
    it("does not close or comment on unrelated issues on recovery", async () => {
      const api = await runStep(incident.file, incident.close, unrelated());
      expect(api.update).not.toHaveBeenCalled();
      expect(api.createComment).not.toHaveBeenCalled();
    });
    it("closes and comments only on its own incident", async () => {
      const api = await runStep(incident.file, incident.close, [...unrelated(), { number: 99, user: ownBot, body: incident.marker }]);
      expect(api.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ issue_number: 99, state: "closed" }));
      expect(api.createComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ issue_number: 99 }));
    });
  });
}

describe("CI failure triage", () => {
  const marker = "<!-- bloombox-ci-failure -->";
  const comments = foreignAuthors.map((user, index) => ({ id: index + 1, user, body: marker }));
  it("does not overwrite comments owned by other bots or users", async () => {
    const api = await runStep("ci-failure-triage", "Notify affected pull requests", comments);
    expect(api.updateComment).not.toHaveBeenCalled();
    expect(api.createComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ issue_number: 10 }));
  });
  it("updates its existing comment", async () => {
    const api = await runStep("ci-failure-triage", "Notify affected pull requests", [...comments, { id: 99, user: ownBot, body: marker }]);
    expect(api.createComment).not.toHaveBeenCalled();
    expect(api.updateComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ comment_id: 99 }));
  });
  it("does not check out or execute fork code or download artifacts in the privileged workflow", () => {
    const source = workflow("ci-failure-triage");
    expect(source).not.toMatch(/actions\/checkout|download-artifact|\bsecrets\.|^\s+run:/m);
    expect(source).toContain("permissions:\n  issues: write\n");
    expect(source).not.toMatch(/contents: write|actions: write/);
  });
});

it.each(["stripe-test-mode-readiness", "commerce-reconciliation"])("restricts the secret-bearing %s job to main", (name) => {
  expect(workflow(name)).toMatch(/jobs:\n  \w+:\n    if: github\.ref == 'refs\/heads\/main'\n/);
});

it("does not persist checkout credentials for the Stripe readiness script", () => {
  expect(workflow("stripe-test-mode-readiness")).toMatch(/uses: actions\/checkout@[^\n]+\n        with:\n          persist-credentials: false/);
});
