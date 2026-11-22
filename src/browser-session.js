import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { Builder } from "selenium-webdriver";
import { scheduleControl } from "./schedule-controls.js";
import { monitorControl } from "./monitor-controls.js";

const EXECUTABLES = {
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  edge: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
};

const LABELS = { chrome: "Google Chrome", edge: "Microsoft Edge", safari: "Safari" };

export class BrowserSession {
  constructor({ rootDir, onClose }) {
    this.rootDir = rootDir;
    this.onClose = onClose;
    this.kind = null;
    this.context = null;
    this.page = null;
    this.driver = null;
    this.closing = false;
  }

  get active() { return Boolean(this.context || this.driver); }
  get label() { return LABELS[this.kind] || "浏览器"; }

  async ensurePage() {
    if (this.driver) return;
    if (!this.context) throw new Error("浏览器尚未连接，请先打开学校网站");
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages().find((page) => !page.isClosed()) ?? await this.context.newPage();
    }
  }

  async launch(kind = "chrome") {
    if (!LABELS[kind]) throw new Error("不支持的浏览器");
    if (this.active && this.kind === kind) return;
    if (this.active) await this.close();
    this.kind = kind;

    if (kind === "safari") {
      let timedOut = false;
      const buildDriver = new Builder().forBrowser("safari").build();
      try {
        this.driver = await Promise.race([
          buildDriver,
          new Promise((_, reject) => setTimeout(() => {
            timedOut = true;
            reject(new Error("SafariDriver 启动超时"));
          }, 15_000)),
        ]);
      } catch (error) {
        if (timedOut) buildDriver.then((driver) => driver.quit()).catch(() => {});
        this.kind = null;
        throw new Error(`Safari 自动化启动失败。请在终端运行 safaridriver --enable，并在 Safari「开发」设置中允许远程自动化。${error.message ? ` 原因：${error.message}` : ""}`);
      }
      return;
    }

    const executablePath = EXECUTABLES[kind];
    if (!fs.existsSync(executablePath)) {
      this.kind = null;
      throw new Error(`${LABELS[kind]} 尚未安装在 Applications 文件夹`);
    }
    const profileDir = path.join(this.rootDir, "runtime", `${kind}-profile`);
    fs.mkdirSync(profileDir, { recursive: true });
    try {
      this.context = await chromium.launchPersistentContext(profileDir, {
        executablePath,
        headless: false,
        viewport: null,
        timeout: 20_000,
        args: ["--start-maximized"],
      });
    } catch (error) {
      this.kind = null;
      throw new Error(`${LABELS[kind]} 自动化连接失败。请确认没有另一份抢课助手占用专用浏览器，完全退出多余的助手后重试。原因：${error.message}`);
    }
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.context.on("close", () => {
      this.context = null;
      this.page = null;
      if (!this.closing) this.onClose?.();
    });
  }

  async close() {
    this.closing = true;
    try {
      if (this.context) await this.context.close().catch(() => {});
      if (this.driver) await this.driver.quit().catch(() => {});
    } finally {
      this.context = null;
      this.page = null;
      this.driver = null;
      this.kind = null;
      this.closing = false;
    }
  }

  async goto(url) {
    if (this.driver) return this.driver.get(url);
    await this.ensurePage();
    return this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  async url() {
    if (this.driver) return this.driver.getCurrentUrl();
    return this.page?.url() ?? "";
  }

  async bodyText() {
    if (this.driver) return this.driver.executeScript("return document.body ? document.body.innerText : '';");
    return this.page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
  }

  async reload() {
    if (this.driver) return this.driver.navigate().refresh();
    return this.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  async wait(ms) {
    if (this.driver) return new Promise((resolve) => setTimeout(resolve, ms));
    return this.page.waitForTimeout(ms);
  }

  async inspectSection(target) {
    const script = `
      const target = arguments[0];
      const normalize = (value) => String(value || "").toUpperCase().replaceAll("-", "*");
      const elements = [...document.querySelectorAll("a, tr, li, article, section, div")]
        .filter((el) => normalize(el.textContent).match(/\\b[A-Z]{2,}\\*[A-Z0-9]+\\*[A-Z0-9]+\\b/)?.[0] === target);
      if (!elements.length) return { found: false, text: "" };
      const scored = elements.map((el) => {
        const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
        let score = 0;
        if (/Seats? Available|This section is full|Registered|\\bPlanned\\b/i.test(text)) score += 20;
        if (el.querySelector("button, a")) score += 5;
        if (text.length > 40 && text.length < 900) score += 10;
        score -= Math.min(text.length / 500, 5);
        return { text, score };
      }).sort((a, b) => b.score - a.score);
      return { found: true, text: scored[0].text };
    `;
    if (this.driver) return this.driver.executeScript(script, target);
    return this.page.evaluate((targetValue) => {
      const normalize = (value) => String(value || "").toUpperCase().replaceAll("-", "*");
      const elements = [...document.querySelectorAll("a, tr, li, article, section, div")]
        .filter((el) => normalize(el.textContent).match(/\b[A-Z]{2,}\*[A-Z0-9]+\*[A-Z0-9]+\b/)?.[0] === targetValue);
      if (!elements.length) return { found: false, text: "" };
      const scored = elements.map((el) => {
        const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        let score = 0;
        if (/Seats? Available|This section is full|Registered|\bPlanned\b/i.test(text)) score += 20;
        if (el.querySelector("button, a")) score += 5;
        if (text.length > 40 && text.length < 900) score += 10;
        score -= Math.min(text.length / 500, 5);
        return { text, score };
      }).sort((a, b) => b.score - a.score);
      return { found: true, text: scored[0].text };
    }, target);
  }

  async scheduleOperation(input) {
    if (this.driver) return this.driver.executeScript(`return (${scheduleControl.toString()})(arguments[0]);`, input);
    return this.page.evaluate(scheduleControl, input);
  }

  async readScheduleTerm() {
    return this.scheduleOperation({ action: "read" });
  }

  async navigateScheduleTerm(direction, expectedTerm) {
    return this.scheduleOperation({ action: "navigate", direction, expectedTerm });
  }

  async clickRegisterNow(expectedTerm = "") {
    const result = await this.scheduleOperation({ action: "register", expectedTerm });
    return result.clicked;
  }

  async monitorOperation(input) {
    const operation = new Function("input", `return (${monitorControl.toString()})(input, (${scheduleControl.toString()}));`);
    if (this.driver) return this.driver.executeScript(`return (${operation.toString()})(arguments[0]);`, input);
    return this.page.evaluate(operation, input);
  }

  async inspectMonitoringSection(code, expectedTerm, shouldStop = () => false) {
    const input = { code, expectedTerm };
    const initial = await this.monitorOperation(input);
    if (!initial.safe) throw new Error("监控学期不一致或仍在加载，已停止，未提交");
    if (!initial.found || initial.registered || shouldStop()) return initial;
    const opened = await this.monitorOperation({ ...input, action: "open-details" });
    if (!opened.clicked) throw new Error(`${code} 无法安全打开班次详情，请关闭其他弹窗后重试`);
    let result;
    let closed = false;
    try {
      const deadline = Date.now() + 10_000;
      while (!shouldStop() && Date.now() < deadline) {
        result = await this.monitorOperation({ ...input, action: "details" });
        if (!result.safe) throw new Error("读取详情时学期发生变化，已停止，未提交");
        if (result.ready) break;
        await this.wait(100);
      }
    } finally {
      closed = (await this.monitorOperation({ ...input, action: "close-details" })).clicked;
    }
    if (shouldStop()) return initial;
    if (!result?.ready || !closed) throw new Error(`${code} 详情加载超时或弹窗无法关闭，已停止，未提交`);
    // Preserve card membership separately from the details' queue headcount.
    return { ...initial, availabilityText: result.detailText };
  }

  async registrationProcessingState() {
    const script = `
      const text = document.body ? document.body.innerText : '';
      const updating = /Updating\s+schedule/i.test(text);
      const refreshing = /Processing\s+complete[.]?\s+Refreshing/i.test(text);
      return { active: updating || refreshing, updating, refreshing };
    `;
    if (this.driver) return this.driver.executeScript(script);
    return this.page.evaluate(() => {
      const text = document.body ? document.body.innerText : "";
      const updating = /Updating\s+schedule/i.test(text);
      const refreshing = /Processing\s+complete[.]?\s+Refreshing/i.test(text);
      return { active: updating || refreshing, updating, refreshing };
    });
  }

  async confirmDialog() {
    const script = `
      const dialog = [...document.querySelectorAll('[role="dialog"], .modal')].find((el) => el.offsetParent !== null);
      if (!dialog) return false;
      const accepted = ['register', 'confirm', 'submit', 'register now'];
      const button = [...dialog.querySelectorAll('button, input[type="button"], input[type="submit"]')]
        .find((el) => accepted.includes((el.innerText || el.value || '').trim().toLowerCase()) && !el.disabled);
      if (!button) return false;
      button.click();
      return true;
    `;
    if (this.driver) return this.driver.executeScript(script);
    return this.page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"], .modal')].find((el) => el.offsetParent !== null);
      if (!dialog) return false;
      const accepted = ["register", "confirm", "submit", "register now"];
      const button = [...dialog.querySelectorAll('button, input[type="button"], input[type="submit"]')]
        .find((el) => accepted.includes((el.innerText || el.value || "").trim().toLowerCase()) && !el.disabled);
      if (!button) return false;
      button.click();
      return true;
    });
  }

  async alertTexts() {
    const script = `return [...document.querySelectorAll('[role="alert"], .toast, .notification, .alert')].filter((el) => el.offsetParent !== null).map((el) => el.innerText || el.textContent || '').slice(-8);`;
    if (this.driver) return this.driver.executeScript(script);
    return this.page.evaluate(() => [...document.querySelectorAll('[role="alert"], .toast, .notification, .alert')]
      .filter((el) => el.offsetParent !== null).map((el) => el.innerText || el.textContent || "").slice(-8));
  }

  async screenshot(filename) {
    if (this.driver) {
      const base64 = await this.driver.takeScreenshot();
      fs.writeFileSync(filename, base64, "base64");
      return;
    }
    await this.page.screenshot({ path: filename, fullPage: true });
  }
}

export { LABELS };
