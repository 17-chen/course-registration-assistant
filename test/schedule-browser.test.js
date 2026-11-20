import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { BrowserSession } from "../src/browser-session.js";
import { RegistrationRunner } from "../src/registration-runner.js";

test("real Chrome: reload defaults to Fall, restores Spring, then submits once", { skip: !process.env.WKU_BROWSER_SMOKE }, async () => {
  const chrome = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const context = await chrome.newContext();
    await context.route("https://wku-test.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <meta charset="utf-8"><style>header{display:flex;gap:15px;align-items:center}button{height:45px;width:60px}#term{width:200px}#register,#remove{width:240px}</style>
      <header><button id="previous" disabled>‹</button><button id="next">›</button><span id="term">Fall 2026 Wenzhou</span><button>+</button><button id="remove">Remove Planned Courses</button><button id="register">Register Now</button></header>
      <main id="courses">Planned</main><script>
      window.clickLog=[];
      document.getElementById('next').onclick=()=>{clickLog.push('next');document.getElementById('courses').setAttribute('aria-busy','true');document.getElementById('term').innerText='Spring 2027 Wenzhou';setTimeout(()=>document.getElementById('courses').removeAttribute('aria-busy'),80)};
      document.getElementById('remove').onclick=()=>{clickLog.push('REMOVE')};
      document.getElementById('register').onclick=()=>{clickLog.push('register:'+document.getElementById('term').innerText)};
      </script>` }));
    const browser = new BrowserSession({ rootDir: "/tmp/course-assistant-test" });
    browser.context = context;
    browser.page = await context.newPage();
    browser.kind = "chrome";
    await browser.goto("https://wku-test.invalid/");
    assert.equal(await browser.clickRegisterNow("Spring 2027 Wenzhou"), false);
    const runner = new RegistrationRunner({ rootDir: "/tmp/course-assistant-test" });
    runner.browser = browser;
    runner.refreshLoginState = async () => true;
    runner.capture = async () => {};
    runner.finish = (phase) => { runner.resultPhase = phase; };
    runner.waitForScheduledResults = async () => [{ code: "PSY*1000*W06", kind: "success" }];
    await runner.runScheduledRegistration({ targetTerm: "Spring 2027 Wenzhou", dryRun: false }, ["PSY*1000*W06"]);
    assert.deepEqual(await browser.page.evaluate(() => window.clickLog), ["next", "register:Spring 2027 Wenzhou"]);
    assert.equal(runner.resultPhase, "success");
    await runner.runScheduledRegistration({ targetTerm: "Spring 2027 Wenzhou", dryRun: true }, []);
    assert.deepEqual(await browser.page.evaluate(() => window.clickLog), ["next"]);
    assert.equal(runner.resultPhase, "dry-run");
  } finally {
    await chrome.close();
  }
});
