import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { BrowserSession } from "../src/browser-session.js";
import { RegistrationRunner } from "../src/registration-runner.js";

function fixture() {
  const clicks = [];
  const element = (text, left, width) => ({
    innerText: text, disabled: false,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left, right: left + width, top: 0, bottom: 40, width, height: 40 }),
    getAttribute: () => null, classList: { contains: () => false },
    click: () => clicks.push(text),
  });
  const previous = element("‹", 0, 50);
  const next = element("›", 60, 50);
  const label = element("Fall 2026 Wenzhou", 130, 200);
  label.parentElement = { querySelectorAll: () => [previous, next] };
  const remove = element("Remove Planned Courses", 400, 300);
  const register = element("Register Now", 710, 200);
  const document = { querySelectorAll: (selector) => selector.startsWith("span") ? [label] : selector.startsWith("[aria-busy") ? [] : [remove, register] };
  return { document, label, clicks };
}

for (const engine of ["chromium", "safari"]) {
  test(`${engine}: refuses wrong-term registration and uses the term arrow only`, async () => {
    const state = fixture();
    const browser = new BrowserSession({ rootDir: "/tmp/course-assistant-test" });
    if (engine === "safari") browser.driver = { executeScript: async (script, input) => vm.runInNewContext(`(function () {${script}})(input)`, { document: state.document, input }) };
    else browser.page = { evaluate: async (fn, input) => vm.runInNewContext(`(${fn.toString()})(input)`, { document: state.document, input }) };
    assert.equal((await browser.readScheduleTerm()).term, "Fall 2026 Wenzhou");
    assert.equal(await browser.clickRegisterNow("Spring 2027 Wenzhou"), false);
    assert.equal((await browser.navigateScheduleTerm("next", "Fall 2026 Wenzhou")).clicked, true);
    state.label.innerText = "Spring 2027 Wenzhou";
    assert.equal(await browser.clickRegisterNow("Spring 2027 Wenzhou"), true);
    assert.deepEqual(state.clicks, ["›", "Register Now"]);
  });
}

test("term restoration waits for the first arrow transition instead of clicking it repeatedly", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  const states = [{ term: "Fall 2026 Wenzhou" }, { term: "Fall 2026 Wenzhou" }, { term: "Spring 2027 Wenzhou", busy: true }, { term: "Spring 2027 Wenzhou" }];
  let arrows = 0;
  runner.browser = {
    readScheduleTerm: async () => states.shift(),
    navigateScheduleTerm: async (direction, current) => { arrows++; assert.equal(direction, "next"); assert.equal(current, "Fall 2026 Wenzhou"); return { clicked: true }; },
    wait: async () => {},
  };
  await runner.restoreScheduleTerm("Spring 2027 Wenzhou");
  assert.equal(arrows, 1);
});

test("term restoration refuses a different campus with the same year and season", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  runner.browser = { readScheduleTerm: async () => ({ term: "Spring 2027 USA" }) };
  await assert.rejects(runner.restoreScheduleTerm("Spring 2027 Wenzhou"), /未点击 Register Now/);
});

test("scheduled registration never clicks if restoring the target term fails", async () => {
  const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
  runner.browser = { reload: async () => {} };
  runner.refreshLoginState = async () => true;
  runner.restoreScheduleTerm = async () => { throw new Error("wrong term"); };
  runner.clickRegisterNow = async () => assert.fail("must not submit the wrong term");
  await assert.rejects(runner.runScheduledRegistration({ targetTerm: "Spring 2027 Wenzhou" }, []), /wrong term/);
});
