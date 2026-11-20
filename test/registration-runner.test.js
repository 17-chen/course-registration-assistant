import test from "node:test";
import assert from "node:assert/strict";
import { RegistrationRunner } from "../src/registration-runner.js";

test("blank browser pages are not reported as logged in", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  runner.browser = { url: async () => "about:blank" };
  assert.equal(await runner.refreshLoginState(), false);
});

test("concurrent browser requests share one browser launch", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  let launches = 0;
  runner.browser = { active: false, kind: null, launch: async (kind) => {
    launches++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    runner.browser.active = true;
    runner.browser.kind = kind;
  } };
  await Promise.all([runner.ensureBrowser("chrome"), runner.ensureBrowser("chrome")]);
  assert.equal(launches, 1);
});

test("browser launch errors become visible instead of staying in launching state", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  runner.browser = { launch: async () => { throw new Error("profile already in use"); } };
  await assert.rejects(runner.ensureBrowser("chrome"), /profile already in use/);
  assert.equal(runner.state.phase, "error");
  assert.match(runner.state.message, /profile already in use/);
  assert.equal(runner.browserLaunch, null);
});

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

test("never repeats a submit when processing does not start", async () => {
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
    assert.equal(fallbackClicks, 0);
  } finally {
    Date.now = originalNow;
  }
});

test("scheduled mode scans planned courses before waiting for the opening time", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const order = [];
  runner.refreshLoginState = async () => true;
  runner.waitForScheduleTerm = async () => ({ term: "Spring 2027 Wenzhou" });
  runner.restoreScheduleTerm = async () => {};
  runner.detectPlannedSections = async () => {
    order.push("scan");
    return ["CPS*2390*W03"];
  };
  runner.runScheduledRegistration = async (_options, planned) => {
    assert.deepEqual(planned, ["CPS*2390*W03"]);
    order.push("scheduled");
    runner.stopRequested = true;
  };

  await runner.runLoop({
    mode: "scheduled",
    startAt: "2000-01-01T00:00:00",
    dryRun: false,
  });
  assert.deepEqual(order, ["scan", "scheduled"]);
});

test("scheduled submission refreshes then waits for an enabled button and clicks only once", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const order = [];
  let attempts = 0;
  runner.browser = { reload: async () => order.push("reload"), wait: async () => {} };
  runner.refreshLoginState = async () => true;
  runner.restoreScheduleTerm = async (term) => { assert.equal(term, "Spring 2027 Wenzhou"); order.push("restore-term"); };
  runner.clickRegisterNow = async () => { order.push("check"); return ++attempts === 3; };
  runner.waitForScheduledResults = async () => [{ code: "CPS*2390*W03", kind: "success" }];
  runner.capture = async () => {};
  runner.finish = (phase) => { runner.resultPhase = phase; };
  await runner.runScheduledRegistration({ dryRun: false, targetTerm: "Spring 2027 Wenzhou" }, ["CPS*2390*W03"]);
  assert.deepEqual(order, ["reload", "restore-term", "check", "check", "check"]);
  assert.equal(runner.resultPhase, "success");
});

test("scheduled dry run refreshes without clicking", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  let refreshed = false;
  runner.browser = { reload: async () => { refreshed = true; } };
  runner.refreshLoginState = async () => true;
  runner.restoreScheduleTerm = async (term) => assert.equal(term, "Spring 2027 Wenzhou");
  runner.capture = async () => {};
  runner.finish = () => {};
  runner.clickRegisterNow = async () => assert.fail("dry run must not submit");
  await runner.runScheduledRegistration({ dryRun: true, targetTerm: "Spring 2027 Wenzhou" }, []);
  assert.equal(refreshed, true);
});

test("scheduled results retain success, full, conflict and unknown separately", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  let busy = true;
  runner.browser = {
    registrationProcessingState: async () => { const active = busy; busy = false; return { active }; },
    wait: async () => {},
  };
  const texts = { A: "Registered, but not started", B: "This section is full", C: "Conflicting section", D: "Planned" };
  runner.inspectSection = async (code) => ({ text: texts[code] });
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => (now += 500);
  try {
    const results = await runner.waitForScheduledResults(Object.keys(texts), 10_000);
    assert.deepEqual(results.map((result) => result.kind), ["success", "full", "blocking", "unknown"]);
  } finally {
    Date.now = originalNow;
  }
});
