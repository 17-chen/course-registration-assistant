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

test("seat monitor clicks once per new availability transition", () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const full = { available: 0, capacity: 24, waitlisted: 0, full: true };
  const open = { available: 1, capacity: 24, waitlisted: 0, full: false };

  assert.equal(runner.evaluateSeatTrigger("CPS*2390*W03", full).shouldAttempt, false);
  assert.equal(runner.evaluateSeatTrigger("CPS*2390*W03", open).shouldAttempt, true);
  assert.equal(runner.evaluateSeatTrigger("CPS*2390*W03", open).shouldAttempt, false);
  assert.equal(runner.evaluateSeatTrigger("CPS*2390*W03", open).reason, "already-attempted");
  assert.equal(runner.evaluateSeatTrigger("CPS*2390*W03", full).shouldAttempt, false);
  assert.equal(runner.evaluateSeatTrigger("CPS*2390*W03", open).shouldAttempt, true);
});

test("waits for updating and refreshing overlays before reading the final result", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const states = [
    { active: true, updating: true, refreshing: false },
    { active: true, updating: false, refreshing: true },
    { active: false, updating: false, refreshing: false },
  ];
  let inspections = 0;
  runner.browser = {
    label: "Google Chrome",
    registrationProcessingState: async () => states.shift() ?? { active: false },
    alertTexts: async () => [],
    wait: async () => {},
  };
  runner.inspectSection = async () => {
    inspections += 1;
    return { text: "Registered, but not started" };
  };

  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => (now += 600);
  try {
    const outcome = await runner.waitForOutcome("CPS*2390*W03", { clickedAt: 10_000 });
    assert.equal(outcome.kind, "success");
    assert.equal(inspections, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("uses at most one fallback click when processing does not start", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  let fallbackClicks = 0;
  runner.browser = {
    label: "Google Chrome",
    registrationProcessingState: async () => ({ active: false }),
    alertTexts: async () => [],
    wait: async () => {},
  };
  runner.inspectSection = async () => ({ text: "Planned This section is full" });
  runner.clickRegisterNow = async () => {
    fallbackClicks += 1;
    return true;
  };

  const originalNow = Date.now;
  let now = 20_000;
  Date.now = () => (now += 1_000);
  try {
    const outcome = await runner.waitForOutcome("CPS*2390*W03", { clickedAt: 20_000 });
    assert.equal(outcome.kind, "unknown");
    assert.equal(fallbackClicks, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("scheduled mode scans planned courses before waiting for the opening time", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const order = [];
  runner.refreshLoginState = async () => true;
  runner.detectPlannedSections = async () => {
    order.push("scan");
    return ["CPS*2390*W03"];
  };
  runner.attemptRegistration = async () => {
    order.push("click");
    runner.stopRequested = true;
  };

  await runner.runLoop({
    mode: "scheduled",
    startAt: "2000-01-01T00:00:00",
    dryRun: false,
  });
  assert.deepEqual(order, ["scan", "click"]);
});
