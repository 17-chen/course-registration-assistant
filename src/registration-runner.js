import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { classifyRegistrationMessage, extractSectionCodes, normalizeSectionCode, parseAvailability } from "./section-parser.js";
import { notify } from "./notifier.js";
import { BrowserSession, LABELS } from "./browser-session.js";

const DEFAULT_URL = "https://kean-ss.colleague.elluciancloud.com/Student/Planning/DegreePlans";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const termOrder = (text) => {
  const match = String(text).match(/^(Winter|Spring|Summer|Fall)\s+(\d{4})/i);
  return match ? Number(match[2]) * 4 + ["winter", "spring", "summer", "fall"].indexOf(match[1].toLowerCase()) : null;
};

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
    this.browserLaunch = null;
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
      results: [],
      targetTerm: null,
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
    if (this.browserLaunch) await this.browserLaunch;
    if (this.browser.active && this.browser.kind === kind) {
      await this.browser.ensurePage?.();
      return;
    }
    fs.mkdirSync(this.logDir, { recursive: true });
    this.publish({ phase: "launching", browser: kind, message: `正在打开 ${LABELS[kind]}…` });
    this.browserLaunch = this.browser.launch(kind);
    try {
      await this.browserLaunch;
    } catch (error) {
      this.publish({ phase: "error", loggedIn: false, message: `浏览器启动失败：${error.message}` });
      throw error;
    } finally {
      this.browserLaunch = null;
    }
  }

  async openPortal(url = DEFAULT_URL, kind = "chrome") {
    if (this.running && this.browser.kind !== kind) throw new Error("请先停止当前监控，再切换浏览器");
    await this.ensureBrowser(kind);
    this.publish({ message: "浏览器已连接，正在打开学校网站…" });
    try {
      await this.browser.goto(url);
    } catch (error) {
      this.publish({ phase: "error", message: `学校页面打开失败：${error.message}。请在助手打开的浏览器里手动输入学校网址，然后点击“读取当前页面”。` });
      throw new Error(this.state.message);
    }
    await this.refreshLoginState();
    if (!this.state.loggedIn) {
      this.publish({ phase: "login", message: `请在 ${this.browser.label} 中完成学校登录，然后点击“读取当前页面”` });
      notify("抢课助手", `请在 ${this.browser.label} 中完成学校登录`);
    }
    return this.state;
  }

  async refreshLoginState() {
    const currentUrl = await this.browser.url();
    const loggedIn = /^https:\/\/kean-ss\.colleague\.elluciancloud\.com\//i.test(currentUrl) && !/\/Account\/Login|saml|login|signin/i.test(currentUrl);
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
      if (options.targetTerm && !/^(Spring|Summer|Fall|Winter)\s+\d{4}(?:\s+[\w .-]+)?$/i.test(options.targetTerm.trim())) throw new Error("请输入完整目标学期，例如 Spring 2027 Wenzhou");
    }
    return {
      url: options.url || DEFAULT_URL,
      selected,
      mode: options.mode,
      startAt: options.startAt,
      intervalMs: Math.max(1000, Math.min(60_000, Number(options.intervalSeconds || 5) * 1000)),
      dryRun: options.dryRun !== false,
      browser: options.browser || "chrome",
      targetTerm: String(options.targetTerm || "").replace(/\s+/g, " ").trim(),
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
      results: [],
      targetTerm: options.targetTerm || null,
      message: options.dryRun ? "演练模式启动中" : "真实提交模式启动中",
    });
    this.runLoop(options).catch((error) => { if (!this.stopRequested) this.finish("error", error.message, true); });
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
      const initialTerm = await this.waitForScheduleTerm();
      const targetTerm = options.targetTerm || initialTerm.term;
      await this.restoreScheduleTerm(targetTerm);
      this.publish({ targetTerm });
      const planned = await this.detectPlannedSections();
      this.publish({
        phase: "waiting",
        message: planned.length
          ? `目标 ${targetTerm}，已预检 ${planned.length} 门 Planned 课程，等待北京时间开放`
          : `目标 ${targetTerm}，未识别到 Planned 课程；等待开放后刷新并核对学期`,
      });
      while (!this.stopRequested && Date.now() < targetTime) {
        const remaining = targetTime - Date.now();
        this.publish({ phase: "waiting", message: `等待开放：还剩 ${this.formatDuration(remaining)}` });
        await delay(Math.min(1000, remaining));
      }
      if (this.stopRequested) return;
      await this.runScheduledRegistration({ ...options, targetTerm }, planned);
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

  async waitForScheduleTerm(previousTerm = null) {
    const deadline = Date.now() + 8000;
    while (!this.stopRequested && Date.now() < deadline) {
      const state = await this.browser.readScheduleTerm();
      if (state.term && state.term !== previousTerm && !state.busy) return state;
      await this.browser.wait(50);
    }
    throw new Error("未能确认 Schedule 学期或学期切换未完成，已停止，未提交课程");
  }

  async restoreScheduleTerm(targetTerm) {
    if (!targetTerm || termOrder(targetTerm) === null) throw new Error("无法确认目标学期，已停止，未提交课程");
    let current = await this.waitForScheduleTerm();
    for (let step = 0; step < 8 && !this.stopRequested; step++) {
      if (current.term.toLowerCase() === targetTerm.toLowerCase()) return;
      const currentOrder = termOrder(current.term);
      const targetOrder = termOrder(targetTerm);
      if (currentOrder === null || currentOrder === targetOrder) break;
      this.publish({ phase: "switching-term", message: `当前 ${current.term}，正在恢复目标 ${targetTerm}…` });
      const direction = currentOrder < targetOrder ? "next" : "previous";
      const result = await this.browser.navigateScheduleTerm(direction, current.term);
      if (!result.clicked) break;
      current = await this.waitForScheduleTerm(current.term);
    }
    throw new Error(`无法切换并确认目标学期 ${targetTerm}，已停止，未点击 Register Now`);
  }

  async runScheduledRegistration(options, planned) {
    this.publish({ phase: "refreshing", message: "已到开放时间，正在刷新学校页面…" });
    await this.browser.reload();
    if (this.stopRequested) return;
    if (!await this.refreshLoginState()) {
      this.finish("login", "刷新后登录已失效，请重新登录", true);
      return;
    }
    await this.restoreScheduleTerm(options.targetTerm);
    if (this.stopRequested) return;
    if (options.dryRun) {
      await this.capture("dry-run-scheduled");
      this.finish("dry-run", `定时演练完成：已刷新并恢复 ${options.targetTerm}，没有点击 Register Now`, true);
      return;
    }

    // Each check resolves the current DOM again after reload. Only a successful
    // enabled-button click ends this loop; no further submit is ever attempted.
    const deadline = Date.now() + 30_000;
    let clickedAt = null;
    while (!this.stopRequested && Date.now() < deadline) {
      const attemptAt = Date.now();
      if (await this.clickRegisterNow(options.targetTerm)) {
        clickedAt = attemptAt;
        break;
      }
      await this.browser.wait(50);
    }
    if (this.stopRequested) return;
    if (clickedAt === null) {
      this.finish("error", "刷新后30秒内 Register Now 未可用，已停止，请检查学校页面", true);
      return;
    }
    this.publish({ phase: "submitting", submittedAt: new Date(clickedAt).toISOString(), message: "已点击 Register Now 一次，等待逐门注册结果…" });
    const results = await this.waitForScheduledResults(planned, clickedAt);
    if (this.stopRequested) return;
    this.publish({ results });
    await this.capture("scheduled-results");
    const succeeded = results.filter((result) => result.kind === "success").length;
    const details = results.map((result) => `${result.code}：${result.kind === "success" ? "成功" : result.kind === "full" ? "满员" : result.kind === "blocking" ? "受限/冲突" : "待人工确认"}`).join("；");
    this.finish(results.length && succeeded === results.length ? "success" : "error",
      `提交结束，成功 ${succeeded}/${results.length} 门。${details || "未识别到课程，请在学校页面核对结果"}。未启动候补监控。`, true);
  }

  async waitForScheduledResults(planned, clickedAt) {
    const deadline = clickedAt + 60_000;
    let processingSeen = false;
    let stableSince = Date.now();
    let previous = "";
    let results = planned.map((code) => ({ code, kind: "unknown", message: "尚未确认" }));
    while (!this.stopRequested && Date.now() < deadline) {
      const processing = await this.browser.registrationProcessingState();
      if (processing.active) {
        processingSeen = true;
        stableSince = Date.now();
        await this.browser.wait(100);
        continue;
      }
      results = await Promise.all(planned.map(async (code) => {
        const snapshot = await this.inspectSection(code);
        return { code, ...classifyRegistrationMessage(snapshot.text) };
      }));
      const signature = JSON.stringify(results);
      if (signature !== previous) {
        previous = signature;
        stableSince = Date.now();
      }
      this.publish({ results, message: `正在核对结果：已确认 ${results.filter((result) => result.kind !== "unknown").length}/${planned.length} 门` });
      // Unknown cards remain explicitly unconfirmed, including partial results.
      if ((processingSeen || (results.length && results.every((result) => result.kind !== "unknown"))) && Date.now() - stableSince >= 2000) return results;
      await this.browser.wait(200);
    }
    return results;
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

  async clickRegisterNow(expectedTerm = "") {
    return this.browser.clickRegisterNow(expectedTerm);
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
    const baseline = new Set(baselineNotices.map((text) => String(text).replace(/\s+/g, " ").trim()));
    let processingSeen = false;
    let inactiveSince = null;

    while (!this.stopRequested && Date.now() < deadline) {
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
