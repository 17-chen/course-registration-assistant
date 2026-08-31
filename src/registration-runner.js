import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { classifyRegistrationMessage, extractSectionCodes, normalizeSectionCode, parseAvailability } from "./section-parser.js";
import { notify } from "./notifier.js";
import { BrowserSession, LABELS } from "./browser-session.js";

const DEFAULT_URL = "https://kean-ss.colleague.elluciancloud.com/Student/Planning/DegreePlans";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RegistrationRunner extends EventEmitter {
  constructor({ rootDir }) {
    super();
    this.rootDir = rootDir;
    this.logDir = path.join(rootDir, "logs");
    this.browser = new BrowserSession({ rootDir, onClose: () => this.handleBrowserClose() });
    this.running = false;
    this.stopRequested = false;
    this.dryRunNotified = new Set();
    this.seatGates = new Map();
    this.state = this.initialState();
  }

  initialState() {
    return {
      phase: "idle",
      message: "尚未启动浏览器",
      running: false,
      loggedIn: false,
      lastCheck: null,
      sections: [],
      selected: [],
      mode: null,
      dryRun: true,
      browser: "chrome",
      refreshCount: 0,
      submittedAt: null,
      processingSeenAt: null,
    };
  }

  publish(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.state);
  }

  handleBrowserClose() {
    this.stopRequested = true;
    this.publish({ phase: "idle", running: false, loggedIn: false, message: "浏览器已关闭，运行已停止" });
  }

  async ensureBrowser(kind = "chrome") {
    if (this.browser.active && this.browser.kind === kind) return;
    fs.mkdirSync(this.logDir, { recursive: true });
    this.publish({ phase: "launching", browser: kind, message: `正在打开 ${LABELS[kind]}…` });
    await this.browser.launch(kind);
  }

  async openPortal(url = DEFAULT_URL, kind = "chrome") {
    if (this.running && this.browser.kind !== kind) throw new Error("请先停止当前监控，再切换浏览器");
    await this.ensureBrowser(kind);
    await this.browser.goto(url);
    await this.refreshLoginState();
    if (!this.state.loggedIn) {
      this.publish({ phase: "login", message: `请在 ${this.browser.label} 中完成学校登录，然后点击“读取当前页面”` });
      notify("抢课助手", `请在 ${this.browser.label} 中完成学校登录`);
    }
    return this.state;
  }

  async refreshLoginState() {
    const currentUrl = await this.browser.url();
    const loggedIn = Boolean(currentUrl) && !/\/Account\/Login|saml|login|signin/i.test(currentUrl);
    this.publish({ loggedIn });
    return loggedIn;
  }

  async scanCurrentPage() {
    await this.ensureBrowser(this.state.browser || "chrome");
    await this.refreshLoginState();
    const bodyText = await this.browser.bodyText().catch(() => "");
    const sections = extractSectionCodes(bodyText);
    this.publish({
      sections,
      phase: this.state.loggedIn ? "ready" : "login",
      message: sections.length ? `已识别 ${sections.length} 个 Section` : "当前页面未识别到 Section，请打开课程列表或 Schedule",
    });
    return { sections, url: await this.browser.url(), loggedIn: this.state.loggedIn, browser: this.browser.kind };
  }

  validateOptions(options) {
    const selected = [...new Set((options.sections ?? []).map(normalizeSectionCode).filter(Boolean))];
    if (!['monitor', 'scheduled'].includes(options.mode)) throw new Error("运行模式无效");
    if (!['chrome', 'edge', 'safari'].includes(options.browser || "chrome")) throw new Error("浏览器选项无效");
    if (options.mode === "monitor" && !selected.length) throw new Error("空位监控模式请至少选择或输入一个 Section Name");
    if (options.mode === "scheduled") {
      const startAt = new Date(`${options.startAt}+08:00`);
      if (Number.isNaN(startAt.getTime())) throw new Error("请输入有效的北京时间开放时间");
    }
    return {
      url: options.url || DEFAULT_URL,
      selected,
      mode: options.mode,
      startAt: options.startAt,
      intervalMs: Math.max(1000, Math.min(60_000, Number(options.intervalSeconds || 5) * 1000)),
      dryRun: options.dryRun !== false,
      browser: options.browser || "chrome",
    };
  }

  async start(rawOptions) {
    if (this.running) throw new Error("助手已经在运行");
    const options = this.validateOptions(rawOptions);
    await this.ensureBrowser(options.browser);
    this.running = true;
    this.stopRequested = false;
    this.dryRunNotified.clear();
    this.seatGates.clear();
    this.publish({
      running: true,
      phase: "starting",
      selected: options.selected,
      mode: options.mode,
      dryRun: options.dryRun,
      browser: options.browser,
      refreshCount: 0,
      submittedAt: null,
      processingSeenAt: null,
      message: options.dryRun ? "演练模式启动中" : "真实提交模式启动中",
    });
    this.runLoop(options).catch((error) => this.finish("error", error.message, true));
    return this.state;
  }

  stop(reason = "用户已停止") {
    this.stopRequested = true;
    if (this.running) this.finish("stopped", reason, false);
    return this.state;
  }

  async runLoop(options) {
    if (!await this.refreshLoginState()) {
      this.finish("login", "登录状态已失效，请重新登录", true);
      return;
    }

    if (options.mode === "scheduled") {
      const targetTime = new Date(`${options.startAt}+08:00`).getTime();
      const planned = await this.detectPlannedSections();
      this.publish({
        phase: "waiting",
        message: planned.length
          ? `已预检 ${planned.length} 门 Planned 课程，等待北京时间开放`
          : "未识别到 Planned 课程；仍会在设定时间点击 Register Now",
      });
      while (!this.stopRequested && Date.now() < targetTime) {
        const remaining = targetTime - Date.now();
        this.publish({ phase: "waiting", message: `等待开放：还剩 ${this.formatDuration(remaining)}` });
        await delay(Math.min(1000, remaining));
      }
      if (this.stopRequested) return;
      await this.attemptRegistration(options, planned[0] || "计划课程", "到达开放时间");
      return;
    }

    let refreshCount = 0;
    while (!this.stopRequested) {
      if (refreshCount > 0) {
        await this.waitForNextRefresh(options.intervalMs);
        if (this.stopRequested) return;
        this.publish({ phase: "refreshing", message: `正在刷新课程页面（第 ${refreshCount + 1} 次）…` });
        await this.reloadForMonitoring();
        if (this.stopRequested) return;
      }
      refreshCount += 1;
      for (const code of options.selected) {
        if (this.stopRequested) return;
        const snapshot = await this.inspectSection(code);
        const gate = this.evaluateSeatTrigger(code, snapshot.availability);
        this.publish({
          phase: "monitoring",
          lastCheck: new Date().toISOString(),
          refreshCount,
          message: snapshot.found
            ? snapshot.availability.available > 0 && !gate.shouldAttempt
              ? `${code}：页面仍显示 ${snapshot.availability.available} 个余位，已触发过一次；继续刷新确认，不重复点击`
              : `${code}：${snapshot.availability.available ?? "未知"} 个余位；继续后台刷新`
            : `${code}：当前页面没有找到该 Section`,
        });
        if (snapshot.found && gate.shouldAttempt) {
          await this.attemptRegistration(options, code, `发现 ${snapshot.availability.available} 个余位`);
          if (!this.running || this.stopRequested) return;
        }
      }
    }
  }

  evaluateSeatTrigger(code, availability) {
    const previous = this.seatGates.get(code) ?? { armed: true };
    if (availability.available === null) {
      this.seatGates.set(code, previous);
      return { shouldAttempt: false, armed: previous.armed, reason: "unknown" };
    }
    if (availability.full || availability.available <= 0) {
      this.seatGates.set(code, { armed: true });
      this.dryRunNotified.delete(code);
      return { shouldAttempt: false, armed: true, reason: "full" };
    }
    if (previous.armed) {
      this.seatGates.set(code, { armed: false });
      return { shouldAttempt: true, armed: false, reason: "new-availability" };
    }
    return { shouldAttempt: false, armed: false, reason: "already-attempted" };
  }

  async waitForNextRefresh(intervalMs) {
    const deadline = Date.now() + intervalMs;
    while (!this.stopRequested && Date.now() < deadline) {
      await delay(Math.min(250, deadline - Date.now()));
    }
  }

  async reloadForMonitoring() {
    await this.browser.reload().catch(() => {});
    await this.browser.wait(700);
  }

  async inspectSection(code) {
    const result = await this.browser.inspectSection(code);
    return { ...result, availability: parseAvailability(result.text) };
  }

  async attemptRegistration(options, code, reason) {
    this.publish({ phase: "attempting", message: `${reason}，准备注册 ${code}` });
    notify("抢课助手", `${code} 已触发注册流程`);

    if (options.dryRun) {
      if (options.mode === "monitor") {
        if (!this.dryRunNotified.has(code)) {
          this.dryRunNotified.add(code);
          await this.capture(`dry-run-${code}`);
          notify("抢课助手演练", `${code} 检测到余位；演练模式未提交，将继续监控`);
        }
        this.publish({ phase: "monitoring", message: `${code} 检测到余位；演练模式继续监控，未点击注册` });
        return;
      }
      await this.capture(`dry-run-scheduled`);
      this.finish("dry-run", "定时演练完成：已到达设定时间，但没有点击 Register Now", false);
      return;
    }

    const baselineNotices = await this.browser.alertTexts().catch(() => []);
    const clickedAt = Date.now();
    const clicked = await this.clickRegisterNow();
    if (!clicked) {
      this.finish("error", "没有找到 Register Now，请确认当前位于 Schedule 页面", true);
      return;
    }
    this.publish({
      phase: "submitting",
      message: `${code} 已点击 Register Now，等待学校系统开始处理…`,
      submittedAt: new Date(clickedAt).toISOString(),
    });
    const outcome = await this.waitForOutcome(code, { baselineNotices, clickedAt });
    await this.capture(`result-${code}`);

    if (outcome.kind === "success") {
      this.finish("success", `${code} 注册成功`, true);
      return;
    }
    if (outcome.kind === "full" && options.mode === "monitor") {
      this.publish({ phase: "monitoring", message: `${code} 被他人抢先，继续监控` });
      return;
    }
    this.finish("error", outcome.message || `${code} 注册未成功`, true);
  }

  async clickRegisterNow() {
    return this.browser.clickRegisterNow();
  }

  async detectPlannedSections() {
    const bodyText = await this.browser.bodyText().catch(() => "");
    const codes = extractSectionCodes(bodyText);
    const planned = [];
    for (const code of codes) {
      const snapshot = await this.inspectSection(code);
      if (/\bPlanned\b/i.test(snapshot.text) && !/Registered/i.test(snapshot.text)) planned.push(code);
    }
    return planned;
  }

  async waitForOutcome(code, { baselineNotices = [], clickedAt = Date.now() } = {}) {
    const deadline = clickedAt + 60_000;
    const retryAt = clickedAt + 2_000;
    const baseline = new Set(baselineNotices.map((text) => String(text).replace(/\s+/g, " ").trim()));
    let processingSeen = false;
    let inactiveSince = null;
    let retried = false;

    while (Date.now() < deadline) {
      const processing = await this.browser.registrationProcessingState().catch(() => ({ active: false }));
      if (processing.active) {
        processingSeen = true;
        inactiveSince = null;
        const message = processing.refreshing
          ? "学校系统处理完成，正在刷新最终结果…"
          : "学校系统正在更新课表，请勿刷新或重复点击…";
        this.publish({ phase: "submitting", message, processingSeenAt: this.state.processingSeenAt || new Date().toISOString() });
        await this.browser.wait(100);
        continue;
      }

      if (processingSeen) {
        inactiveSince ??= Date.now();
        if (Date.now() - inactiveSince < 500) {
          await this.browser.wait(100);
          continue;
        }
      }

      const notices = await this.browser.alertTexts().catch(() => []);
      for (const notice of notices.slice(-8)) {
        const normalizedNotice = String(notice).replace(/\s+/g, " ").trim();
        if (!processingSeen && baseline.has(normalizedNotice)) continue;
        const noticeResult = classifyRegistrationMessage(notice);
        if (noticeResult.kind !== "unknown") return noticeResult;
      }

      const section = await this.inspectSection(code);
      const sectionResult = classifyRegistrationMessage(section.text);
      if (sectionResult.kind === "success") return sectionResult;
      if (processingSeen && sectionResult.kind === "blocking") return sectionResult;
      if (processingSeen && sectionResult.kind === "full") return sectionResult;

      if (!processingSeen && !retried && Date.now() >= retryAt) {
        retried = true;
        const clickedAgain = await this.clickRegisterNow();
        this.publish({
          phase: "submitting",
          message: clickedAgain
            ? "首次点击后未检测到处理状态，已执行唯一一次兜底点击…"
            : "首次点击后未检测到处理状态，Register Now 当前不可再次点击；继续等待…",
        });
      }
      await this.browser.wait(100);
    }
    return {
      kind: "unknown",
      message: `提交后60秒内没有识别到明确结果。为避免重复提交，助手已停止，请查看 ${this.browser.label} 页面`,
    };
  }

  async capture(prefix) {
    fs.mkdirSync(this.logDir, { recursive: true });
    const safe = prefix.replace(/[^a-zA-Z0-9*-]+/g, "-");
    const filename = `${new Date().toISOString().replaceAll(":", "-")}-${safe}.png`;
    await this.browser.screenshot(path.join(this.logDir, filename)).catch(() => {});
  }

  finish(phase, message, alertUser) {
    this.running = false;
    this.stopRequested = true;
    this.publish({ phase, message, running: false, lastCheck: new Date().toISOString() });
    if (alertUser) notify(phase === "success" ? "抢课成功" : "抢课助手已停止", message, phase === "success" ? "Glass" : "Basso");
  }

  formatDuration(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时 ${minutes}分 ${seconds % 60}秒`;
  }
}

export { DEFAULT_URL };
