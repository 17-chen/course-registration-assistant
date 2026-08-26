const $ = (selector) => document.querySelector(selector);
const elements = {
  portalUrl: $("#portalUrl"), browserChoice: $("#browserChoice"), browserHint: $("#browserHint"), openPortal: $("#openPortal"), scanPage: $("#scanPage"),
  loginState: $("#loginState"), sections: $("#sections"), sectionCount: $("#sectionCount"),
  detectedSections: $("#detectedSections"), scheduleFields: $("#scheduleFields"), sectionCard: $("#sectionCard"),
  startDate: $("#startDate"), interval: $("#interval"), intervalField: $("#intervalField"), dryRun: $("#dryRun"),
  statusPill: $("#statusPill"), message: $("#message"), lastCheck: $("#lastCheck"),
  progressBar: $("#progressBar"), start: $("#start"), stop: $("#stop"), testNotify: $("#testNotify"),
};

const wheelValues = { hour: 0, minute: 0, second: 0 };

function pad(value) { return String(value).padStart(2, "0"); }

function buildWheel(unit, maximum, initial) {
  const column = document.querySelector(`[data-unit="${unit}"]`);
  const spacer = document.createElement("div");
  spacer.className = "wheel-spacer";
  column.append(spacer);
  for (let value = 0; value <= maximum; value += 1) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "wheel-option";
    option.textContent = pad(value);
    option.dataset.value = value;
    column.append(option);
  }
  column.append(spacer.cloneNode());
  wheelValues[unit] = initial;
  requestAnimationFrame(() => { column.scrollTop = initial * 48; });
  let timer;
  column.addEventListener("scroll", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const selected = Math.max(0, Math.min(maximum, Math.round(column.scrollTop / 48)));
      wheelValues[unit] = selected;
      column.scrollTo({ top: selected * 48, behavior: "smooth" });
      column.querySelectorAll(".wheel-option").forEach((item) => item.classList.toggle("selected", Number(item.dataset.value) === selected));
    }, 70);
  });
  column.addEventListener("click", (event) => {
    const option = event.target.closest(".wheel-option");
    if (option) column.scrollTo({ top: Number(option.dataset.value) * 48, behavior: "smooth" });
  });
  column.querySelector(`[data-value="${initial}"]`)?.classList.add("selected");
}

const now = new Date();
elements.startDate.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
buildWheel("hour", 23, now.getHours());
buildWheel("minute", 59, now.getMinutes());
buildWheel("second", 59, 0);

async function api(path, data = null) {
  const response = await fetch(path, {
    method: data === null ? "GET" : "POST",
    headers: data === null ? {} : { "Content-Type": "application/json" },
    body: data === null ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败");
  return result;
}

function sectionValues() {
  return elements.sections.value.split(/\n|,/).map((value) => value.trim()).filter(Boolean);
}

function updateSectionCount() {
  elements.sectionCount.textContent = `${sectionValues().length} 个`;
}

function render(state) {
  elements.message.textContent = state.message || "等待操作";
  elements.loginState.textContent = state.loggedIn ? "Chrome 登录状态：已进入学校系统" : "尚未确认登录状态";
  elements.start.disabled = Boolean(state.running);
  elements.stop.disabled = !state.running;
  elements.progressBar.classList.toggle("running", Boolean(state.running));
  const status = state.running ? "运行中" : state.phase === "success" ? "成功" : state.phase === "error" ? "已停止" : "未运行";
  elements.statusPill.className = `status ${state.running ? "running" : state.phase || "idle"}`;
  elements.statusPill.querySelector("b").textContent = status;
  elements.lastCheck.textContent = state.lastCheck ? new Date(state.lastCheck).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";
}

function renderDetected(sections) {
  elements.detectedSections.innerHTML = "";
  for (const code of sections) {
    const button = document.createElement("button");
    button.className = "chip";
    button.textContent = `＋ ${code}`;
    button.addEventListener("click", () => {
      const values = sectionValues();
      if (!values.includes(code)) elements.sections.value = [...values, code].join("\n");
      updateSectionCount();
    });
    elements.detectedSections.append(button);
  }
}

for (const radio of document.querySelectorAll('[name="mode"]')) {
  radio.addEventListener("change", () => {
    document.querySelectorAll(".mode").forEach((label) => label.classList.toggle("active", label.querySelector("input").checked));
    const scheduled = radio.value === "scheduled" && radio.checked;
    elements.scheduleFields.classList.toggle("hidden", !scheduled);
    elements.sectionCard.classList.toggle("hidden", scheduled);
    elements.intervalField.classList.toggle("hidden", scheduled);
  });
}

elements.sections.addEventListener("input", updateSectionCount);
elements.browserChoice.addEventListener("change", () => {
  const hints = {
    chrome: "Chrome 使用独立配置保存登录状态，推荐长期监控使用。",
    edge: "这台 Mac 当前未检测到 Edge；安装后即可使用独立配置运行。",
    safari: "Safari 使用隔离的自动化窗口。首次使用需运行 safaridriver --enable 并允许远程自动化。",
  };
  elements.browserHint.textContent = hints[elements.browserChoice.value];
});
elements.openPortal.addEventListener("click", async () => {
  const originalText = elements.openPortal.textContent;
  elements.openPortal.disabled = true;
  elements.openPortal.textContent = "正在打开…";
  elements.message.textContent = `正在启动 ${elements.browserChoice.options[elements.browserChoice.selectedIndex].text}，请稍候…`;
  try { render(await api("/api/open", { url: elements.portalUrl.value, browser: elements.browserChoice.value })); }
  catch (error) { elements.message.textContent = error.message; }
  finally {
    elements.openPortal.disabled = false;
    elements.openPortal.textContent = originalText;
  }
});
elements.scanPage.addEventListener("click", async () => {
  try {
    const result = await api("/api/scan", {});
    renderDetected(result.sections);
    render({ ...result, message: result.sections.length ? `识别到 ${result.sections.length} 个 Section，可点击下方标签添加` : "未识别到 Section" });
  } catch (error) { elements.message.textContent = error.message; }
});
elements.start.addEventListener("click", async () => {
  try {
    const mode = document.querySelector('[name="mode"]:checked').value;
    const startAt = mode === "scheduled"
      ? `${elements.startDate.value}T${pad(wheelValues.hour)}:${pad(wheelValues.minute)}:${pad(wheelValues.second)}`
      : "";
    const result = await api("/api/start", {
      url: elements.portalUrl.value,
      sections: mode === "monitor" ? sectionValues() : [], mode, startAt,
      intervalSeconds: Number(elements.interval.value), dryRun: elements.dryRun.checked, browser: elements.browserChoice.value,
    });
    render(result);
  } catch (error) { elements.message.textContent = error.message; }
});
elements.stop.addEventListener("click", async () => render(await api("/api/stop", {})));
elements.testNotify.addEventListener("click", async () => api("/api/notify", {}));

const initial = await api("/api/state");
elements.portalUrl.value = initial.defaultUrl;
elements.browserChoice.value = initial.browser || "chrome";
render(initial);
updateSectionCount();
new EventSource("/api/events").onmessage = (event) => render(JSON.parse(event.data));
