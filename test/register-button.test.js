import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { BrowserSession } from "../src/browser-session.js";

test("opening the portal recovers a closed tab using another live tab", async () => {
  const browser = new BrowserSession({ rootDir: "/tmp/course-assistant-test" });
  let visited = null;
  const live = { isClosed: () => false, goto: async (url) => { visited = url; } };
  browser.page = { isClosed: () => true };
  browser.context = { pages: () => [live] };
  await browser.goto("https://example.test/");
  assert.equal(visited, "https://example.test/");
});

test("opening the portal recreates a tab when all previous tabs are closed", async () => {
  const browser = new BrowserSession({ rootDir: "/tmp/course-assistant-test" });
  let created = 0;
  const live = { isClosed: () => false, goto: async () => {} };
  browser.page = { isClosed: () => true };
  browser.context = { pages: () => [], newPage: async () => { created++; return live; } };
  await browser.goto("https://example.test/");
  assert.equal(created, 1);
  assert.equal(browser.page, live);
});

for (const engine of ["chromium", "safari"]) {
  test(`${engine}: reads the target card rather than a different course mentioning it`, async () => {
    const card = (text) => ({ textContent: text, innerText: text, querySelector: () => ({}) });
    const context = { document: { querySelectorAll: () => [
      card("HIST*1062*W03 Registered, but not started. Conflicting section with PSY*1000*W06"),
      card("PSY*1000*W06 General Psychology Planned Conflicting section with HIST*1062*W03"),
    ] } };
    const browser = new BrowserSession({ rootDir: "/tmp/course-assistant-test" });
    if (engine === "safari") browser.driver = { executeScript: async (script, target) => vm.runInNewContext(`(function () {${script}})(target)`, { ...context, target }) };
    else browser.page = { evaluate: async (fn, target) => vm.runInNewContext(`(${fn.toString()})(target)`, { ...context, target }) };
    const result = await browser.inspectSection("PSY*1000*W06");
    assert.match(result.text, /^PSY/);
    assert.doesNotMatch(result.text, /Registered/);
  });
  test(`${engine}: ignores Remove, hidden and disabled buttons; reacquires after refresh`, async () => {
    const clicked = [];
    const button = (text, options = {}) => ({
      innerText: text,
      disabled: Boolean(options.disabled),
      getAttribute: () => options.ariaDisabled ? "true" : null,
      classList: { contains: () => Boolean(options.disabledClass) },
      getClientRects: () => options.hidden ? [] : [{}],
      click: () => clicked.push(text),
    });
    let buttons = [button("Remove Planned Courses"), button("Register Now", { disabled: true })];
    const context = { document: { querySelectorAll: () => buttons } };
    const browser = new BrowserSession({ rootDir: "/tmp/course-assistant-test" });
    if (engine === "safari") browser.driver = { executeScript: async (script, input) => vm.runInNewContext(`(function () {${script}})(input)`, { ...context, input }) };
    else browser.page = { evaluate: async (fn, input) => vm.runInNewContext(`(${fn.toString()})(input)`, { ...context, input }) };
    assert.equal(await browser.clickRegisterNow(), false);
    buttons = [button("Remove Planned Courses"), button("Register"), button("Register Now", { hidden: true }), button("Register Now", { ariaDisabled: true }), button("Register Now", { disabledClass: true }), button("Register Now")];
    assert.equal(await browser.clickRegisterNow(), true);
    assert.deepEqual(clicked, ["Register Now"]);
  });
}
