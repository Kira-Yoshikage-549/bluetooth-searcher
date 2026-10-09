"use strict";

const startButton = document.getElementById("startButton");
const errorMessage = document.getElementById("homeError");
const loadingMessage = document.getElementById("homeLoading");
const retryStatusButton = document.getElementById("retryStatusButton");
const homeConnection = document.getElementById("homeConnection");
const homeRadio = document.getElementById("homeRadio");
const homeScan = document.getElementById("homeScan");
const homeDeviceCount = document.getElementById("homeDeviceCount");
const homeFreshCount = document.getElementById("homeFreshCount");
const homeClock = document.getElementById("homeClock");
const homeScreen = document.getElementById("homeScreen");
const terminalTitle = document.getElementById("terminalTitle");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const numberFormat = new Intl.NumberFormat("zh-CN");
const clockFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const radioLabels = { on: "已开启", off: "已关闭", missing: "未找到", disabled: "已禁用", unknown: "未知" };
const scanLabels = { stopped: "待命", scanning: "扫描中", error: "需要处理" };
let currentStatus = null;
let connected = false;
let starting = false;
let departing = false;
let activePage = true;
let startError = "";
let pollError = "";
let statusGeneration = 0;
let pollController = null;
let pollTimer = null;
let pollAgainImmediately = false;
let clockTimer = null;
let typingTimer = null;
let bootTimer = null;

function canPoll() {
  return activePage && !document.hidden && !starting && !departing;
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setReadout(element, text, state) {
  if (!element) return;
  setText(element, text);
  element.dataset.state = state;
}

function formatCount(value) {
  return Number.isFinite(value) && value >= 0 ? numberFormat.format(value) : "—";
}

function renderHomeStatus() {
  const connectionState = connected ? "connected" : pollError ? "error" : "connecting";
  if (homeConnection) {
    homeConnection.dataset.state = connectionState;
    setText(homeConnection.querySelector("span:last-child"), connected ? "本机服务已连接" : pollError ? "本机服务连接异常" : "正在连接本机服务…");
  }
  setReadout(homeRadio, connected ? radioLabels[currentStatus?.radio_state] || "未知" : "未知", connected ? currentStatus?.radio_state || "unknown" : "unknown");
  setReadout(homeScan, starting ? "正在启动…" : connected ? scanLabels[currentStatus?.scan_state] || "未知" : "未知", starting ? "starting" : connected ? currentStatus?.scan_state || "unknown" : "unknown");
  setText(homeDeviceCount, connected ? formatCount(currentStatus?.device_count) : "—");
  setText(homeFreshCount, connected ? formatCount(currentStatus?.fresh_count) : "—");
  const error = starting ? "" : startError || pollError || (connected ? currentStatus?.error : "") || "";
  setText(errorMessage, error);
  if (errorMessage) {
    errorMessage.classList.toggle("is-empty", !error);
    errorMessage.dataset.tone = error ? "error" : "";
    const notice = errorMessage.closest(".home-notice, .notice");
    if (notice) notice.dataset.tone = error ? "error" : "";
  }
  if (retryStatusButton) {
    retryStatusButton.hidden = !pollError;
    retryStatusButton.disabled = starting;
  }
}

function stopPolling() {
  window.clearTimeout(pollTimer);
  pollTimer = null;
  pollAgainImmediately = false;
  statusGeneration += 1;
  pollController?.abort();
}

async function pollStatus() {
  window.clearTimeout(pollTimer);
  pollTimer = null;
  if (!canPoll()) return;
  if (pollController) {
    pollAgainImmediately = true;
    return;
  }
  const controller = new AbortController();
  pollController = controller;
  const generation = statusGeneration;
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 6000);
  try {
    const response = await fetch("/api/status", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error("本机服务状态读取失败，请重试。");
    const status = await response.json();
    if (!status || typeof status.scan_state !== "string" || typeof status.radio_state !== "string") {
      throw new Error("本机服务返回了无效状态，请重试。");
    }
    if (generation !== statusGeneration || !canPoll()) return;
    currentStatus = status;
    connected = true;
    pollError = "";
    renderHomeStatus();
  } catch (error) {
    if (generation !== statusGeneration || !canPoll()) return;
    if (error.name === "AbortError" && !timedOut) return;
    connected = false;
    currentStatus = null;
    pollError = timedOut ? "本机服务响应超时，请检查服务后重试。" : error.name === "SyntaxError" ? "本机服务返回了无效响应，请重试。" : error.name === "TypeError" ? "无法连接本机服务，请检查服务后重试。" : error.message || "无法连接本机服务，请检查服务后重试。";
    renderHomeStatus();
  } finally {
    window.clearTimeout(timeout);
    pollController = null;
    if (canPoll()) {
      const delay = pollAgainImmediately ? 0 : 2000;
      pollAgainImmediately = false;
      pollTimer = window.setTimeout(pollStatus, delay);
    }
  }
}

function updateClock() {
  if (!homeClock || document.hidden || !activePage) return;
  const now = new Date();
  setText(homeClock, clockFormat.format(now));
  if (homeClock.tagName === "TIME") homeClock.dateTime = now.toISOString();
}

function finishDecorativeMotion() {
  window.clearInterval(typingTimer);
  typingTimer = null;
  terminalTitle?.querySelectorAll(".terminal-character").forEach((character) => { character.style.opacity = "1"; });
  window.clearTimeout(bootTimer);
  bootTimer = null;
  homeScreen?.classList.remove("crt-boot");
}

function startDecorativeMotion() {
  if (!terminalTitle) return;
  const text = "BLE SIGNAL TERMINAL";
  const characters = Array.from(text, (character) => {
    const span = document.createElement("span");
    span.className = "terminal-character";
    span.textContent = character;
    span.style.opacity = motionPreference.matches || document.hidden ? "1" : "0";
    return span;
  });
  terminalTitle.setAttribute("aria-hidden", "true");
  terminalTitle.replaceChildren(...characters);
  if (motionPreference.matches || document.hidden) return;
  let characterIndex = 0;
  typingTimer = window.setInterval(() => {
    characters[characterIndex].style.opacity = "1";
    characterIndex += 1;
    if (characterIndex === characters.length) {
      window.clearInterval(typingTimer);
      typingTimer = null;
    }
  }, 83);
  homeScreen?.classList.add("crt-boot");
  bootTimer = window.setTimeout(() => {
    homeScreen?.classList.remove("crt-boot");
    bootTimer = null;
  }, 415);
}

function syncPageActivity() {
  window.clearInterval(clockTimer);
  clockTimer = null;
  if (!activePage || document.hidden) {
    stopPolling();
    finishDecorativeMotion();
    return;
  }
  updateClock();
  clockTimer = window.setInterval(updateClock, 1000);
  pollStatus();
}

startButton.addEventListener("click", async () => {
  if (starting || departing) return;
  starting = true;
  startError = "";
  stopPolling();
  startButton.disabled = true;
  startButton.setAttribute("aria-busy", "true");
  startButton.classList.add("is-busy");
  setText(loadingMessage, "正在启动…");
  renderHomeStatus();
  try {
    const response = await fetch("/api/scan/start", { method: "POST" });
    const status = await response.json();
    if (!response.ok || status?.scan_state !== "scanning") {
      if (status?.scan_state && status?.radio_state) {
        currentStatus = status;
        connected = true;
        pollError = "";
      }
      throw new Error(status?.error || "扫描未能启动，请检查蓝牙后重试。");
    }
    currentStatus = status;
    connected = true;
    pollError = "";
    departing = true;
    renderHomeStatus();
    finishDecorativeMotion();
    try { window.ScanTransition?.prepare(startButton); } catch (_) { /* The scan handoff is optional visual decoration. */ }
    window.location.assign("/monitor");
  } catch (error) {
    starting = false;
    departing = false;
    startError = error.name === "SyntaxError" ? "本机服务返回了无效响应，请稍后重试。" : error.name === "TypeError" ? "无法连接本机服务，请稍后重试。" : error.message || "无法连接本机服务，请稍后重试。";
    startButton.disabled = false;
    startButton.setAttribute("aria-busy", "false");
    startButton.classList.remove("is-busy");
    setText(loadingMessage, "");
    renderHomeStatus();
    pollStatus();
  }
});

retryStatusButton?.addEventListener("click", () => pollStatus());
document.addEventListener("visibilitychange", syncPageActivity);
window.addEventListener("pagehide", () => {
  activePage = false;
  syncPageActivity();
});
window.addEventListener("pageshow", (event) => {
  activePage = true;
  if (event.persisted) {
    starting = false;
    departing = false;
    startButton.disabled = false;
    startButton.removeAttribute("aria-busy");
    startButton.classList.remove("is-busy");
    setText(loadingMessage, "");
    renderHomeStatus();
    syncPageActivity();
  }
});
motionPreference.addEventListener("change", () => {
  if (motionPreference.matches) finishDecorativeMotion();
});

renderHomeStatus();
startDecorativeMotion();
syncPageActivity();
