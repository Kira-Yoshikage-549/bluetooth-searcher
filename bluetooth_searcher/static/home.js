"use strict";

const startButton = document.getElementById("startButton");
const errorMessage = document.getElementById("homeError");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
let starting = false;

function syncSignalMotion() {
  document.body.dataset.scanning = String(starting);
  document.body.dataset.artActive = String(!document.hidden && !motionPreference.matches);
}

startButton.addEventListener("click", async () => {
  if (starting) return;
  starting = true;
  startButton.disabled = true;
  startButton.setAttribute("aria-busy", "true");
  startButton.textContent = "正在启动…";
  errorMessage.hidden = true;
  syncSignalMotion();
  try {
    const response = await fetch("/api/scan/start", { method: "POST" });
    const status = await response.json();
    if (!response.ok || status.scan_state !== "scanning") {
      throw new Error(status.error || "扫描未能启动，请稍后重试。");
    }
    window.location.assign("/monitor");
  } catch (error) {
    starting = false;
    startButton.disabled = false;
    startButton.setAttribute("aria-busy", "false");
    startButton.textContent = "开始扫描";
    errorMessage.textContent = error.message || "无法连接本机服务，请稍后重试。";
    errorMessage.hidden = false;
    syncSignalMotion();
  }
});

document.addEventListener("visibilitychange", syncSignalMotion);
motionPreference.addEventListener("change", syncSignalMotion);
syncSignalMotion();

