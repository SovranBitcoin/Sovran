import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
// Exercise Bun as an external CLI. Nested Bun-test subprocesses on Bun 1.3.5
// discard stdout even for `bun -e 'console.log(123)'` on this host.
const bun = execFileSync("bun", ["-p", "process.execPath"], {
  encoding: "utf8",
}).trim();
test("press planning needs no native tools and emits no reset authorization", () => {
  const output = execFileSync(bun, ["app/e2e/press/run.ts", "both", "--plan"], {
    cwd: root,
    env: { PATH: "/nonexistent" },
    encoding: "utf8",
    timeout: 30_000,
  });
  const plan = JSON.parse(output);
  assert.equal(plan.captures.length, 62);
  assert.equal(plan.invocations.length, 10);
  assert(
    plan.invocations.every((item) =>
      item.scenarios.every((scenario) => scenario.lane === "simulator"),
    ),
  );
  assert(!output.includes("i-approve-destructive-reset"));
});

test("full-library planning keeps both platform denominators without native tools", () => {
  const output = execFileSync(
    bun,
    ["app/e2e/capture/refresh.ts", "both", "--plan"],
    {
      cwd: root,
      env: { PATH: "/nonexistent" },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const plan = JSON.parse(output);
  assert.equal(plan.baselineDenominator, 202);
  assert.equal(plan.targets.filter((target) => target.baseline).length, 202);
  assert(plan.blocked.every((target) => target.blocker));
  assert(plan.sessions.every((session) => session.scenario));
  assert.equal(plan.sessions[0].platform, "ios");
  assert.equal(plan.sessions[1].platform, "android");
  assert.equal(plan.sessions[0].scenario, plan.sessions[1].scenario);
});
