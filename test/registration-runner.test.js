import test from "node:test";
import assert from "node:assert/strict";
import { RegistrationRunner } from "../src/registration-runner.js";

test("validates and normalizes monitor options", () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const options = runner.validateOptions({
    mode: "monitor",
    sections: ["cps-2390-w03", "CPS*2390*W03", "acct*2200*w01"],
    intervalSeconds: 0,
  });
  assert.deepEqual(options.selected, ["CPS*2390*W03", "ACCT*2200*W01"]);
  assert.equal(options.intervalMs, 5000);
  assert.equal(options.dryRun, true);
});

test("requires a Beijing opening time in scheduled mode", () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  assert.throws(
    () => runner.validateOptions({ mode: "scheduled", sections: ["CPS*2390*W03"], startAt: "" }),
    /北京时间/,
  );
});

test("scheduled mode does not require manually selected sections", () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const options = runner.validateOptions({
    mode: "scheduled",
    sections: [],
    startAt: "2026-09-01T09:00:00",
  });
  assert.deepEqual(options.selected, []);
});

test("monitor dry run keeps running after detecting a seat", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  runner.running = true;
  runner.capture = async () => {};
  await runner.attemptRegistration({ mode: "monitor", dryRun: true }, "CPS*2390*W03", "发现 1 个余位");
  assert.equal(runner.running, true);
  assert.equal(runner.stopRequested, false);
  assert.match(runner.state.message, /继续监控/);
});

test("accepts Chrome, Edge, and Safari browser choices", () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  for (const browser of ["chrome", "edge", "safari"]) {
    const options = runner.validateOptions({ mode: "monitor", sections: ["CPS*2390*W03"], browser });
    assert.equal(options.browser, browser);
  }
  assert.throws(
    () => runner.validateOptions({ mode: "monitor", sections: ["CPS*2390*W03"], browser: "unknown" }),
    /浏览器/,
  );
});
