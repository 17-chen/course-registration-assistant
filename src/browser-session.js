import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { Builder } from "selenium-webdriver";

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

  async launch(kind = "chrome") {
    if (!LABELS[kind]) throw new Error("不支持的浏览器");
    if (this.active && this.kind === kind) return;
    if (this.active) await this.close();
    this.kind = kind;

    if (kind === "safari") {
      try {
        this.driver = await new Builder().forBrowser("safari").build();
      } catch (error) {
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
    this.context = await chromium.launchPersistentContext(profileDir, {
      executablePath,
      headless: false,
      viewport: null,
      args: ["--start-maximized"],
    });
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
        .filter((el) => normalize(el.textContent).includes(target));
      if (!elements.length) return { found: false, text: "" };
      const scored = elements.map((el) => {
        const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
        let score = 0;
        if (/Seats? Available|This section is full|Registered/i.test(text)) score += 20;
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
        .filter((el) => normalize(el.textContent).includes(targetValue));
      if (!elements.length) return { found: false, text: "" };
      const scored = elements.map((el) => {
        const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        let score = 0;
        if (/Seats? Available|This section is full|Registered/i.test(text)) score += 20;
        if (el.querySelector("button, a")) score += 5;
        if (text.length > 40 && text.length < 900) score += 10;
        score -= Math.min(text.length / 500, 5);
        return { text, score };
      }).sort((a, b) => b.score - a.score);
      return { found: true, text: scored[0].text };
    }, target);
  }

  async clickRegisterNow() {
    const script = `
      const candidates = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
      const target = candidates.find((el) => (el.innerText || el.value || '').trim().toLowerCase() === 'register now' && !el.disabled);
      if (!target) return false;
      target.click();
      return true;
    `;
    if (this.driver) return this.driver.executeScript(script);
    return this.page.evaluate(() => {
      const candidates = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
      const target = candidates.find((el) => (el.innerText || el.value || "").trim().toLowerCase() === "register now" && !el.disabled);
      if (!target) return false;
      target.click();
      return true;
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
