"use strict";

const startButton = document.getElementById("startButton");
const errorMessage = document.getElementById("homeError");
const loadingMessage = document.getElementById("homeLoading");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const hoverPointer = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");
const homeContent = document.getElementById("homeContent");
const signalArt = document.getElementById("signalArt");
const signalScene = document.getElementById("signalScene");
const signalFieldLayer = document.getElementById("signalFieldLayer");
const signalCoreLayer = document.getElementById("signalCoreLayer");
const strengthToggle = document.getElementById("strengthToggle");
const signalSymbol = document.getElementById("signalSymbol");
const strengthStatus = document.getElementById("strengthStatus");
const scanCtaWrap = document.getElementById("scanCtaWrap");
let starting = false;
let ripplePointerInside = false;
let rippleDismissed = false;
let rippleFadeTimer = null;
let signalFrame = null;
let strengthFrame = null;
let strengthStatusTimer = null;
let lastFrameTime = 0;
let homeContentBounds = null;
let signalCenter = null;
let homeContentVisible = typeof IntersectionObserver !== "function";
const signalPosition = { x: 0, y: 0, targetX: 0, targetY: 0 };
const pointerPosition = { x: 0, y: 0, active: false };
const strengthKeys = ["idle", "weak", "medium", "strong"];
const strengthNames = ["未激活", "弱信号", "中信号", "强信号"];
const strengthBars = ["", "一格", "两格", "三格"];
const strengthHysteresis = 0.015;
let strengthLevel = 0;

function setStrengthLevel(level) {
  if (strengthLevel === level || !strengthToggle || !signalSymbol || !strengthStatus) return;
  strengthLevel = level;
  signalSymbol.dataset.level = strengthKeys[level];
  const nextLevel = level === 3 ? 1 : level + 1;
  strengthToggle.setAttribute("aria-label", `当前演示信号：${strengthNames[level]}${level ? `，${strengthBars[level]}` : ""}。点击切换至${strengthNames[nextLevel]}`);
  if (strengthStatusTimer !== null) window.clearTimeout(strengthStatusTimer);
  strengthStatusTimer = window.setTimeout(() => {
    strengthStatus.textContent = `演示信号：${strengthNames[level]}${level ? `，${strengthBars[level]}` : ""}。`;
    strengthStatusTimer = null;
  }, 180);
}

function clearStrengthInteraction() {
  pointerPosition.active = false;
  if (strengthFrame !== null) window.cancelAnimationFrame(strengthFrame);
  strengthFrame = null;
  setStrengthLevel(0);
}

function getSignalCenter() {
  if (!signalCenter) {
    const artBounds = signalArt.getBoundingClientRect();
    signalCenter = {
      x: artBounds.left + strengthToggle.offsetLeft + strengthToggle.offsetWidth / 2,
      y: artBounds.top + strengthToggle.offsetTop + strengthToggle.offsetHeight / 2,
    };
  }
  return signalCenter;
}

function levelForDistance(distance) {
  const inner = 1 / 3;
  const outer = 2 / 3;
  if (strengthLevel === 3) {
    if (distance > outer + strengthHysteresis) return 1;
    if (distance > inner + strengthHysteresis) return 2;
    return 3;
  }
  if (strengthLevel === 2) {
    if (distance < inner - strengthHysteresis) return 3;
    if (distance > outer + strengthHysteresis) return 1;
    return 2;
  }
  if (strengthLevel === 1) {
    if (distance < inner - strengthHysteresis) return 3;
    if (distance < outer - strengthHysteresis) return 2;
    return 1;
  }
  return distance <= inner ? 3 : distance <= outer ? 2 : 1;
}

function queueStrengthUpdate() {
  if (strengthFrame !== null || !pointerPosition.active) return;
  strengthFrame = window.requestAnimationFrame(() => {
    strengthFrame = null;
    if (!pointerPosition.active || document.hidden) return;
    const center = getSignalCenter();
    const radiusX = Math.max(center.x, window.innerWidth - center.x);
    const radiusY = Math.max(center.y, window.innerHeight - center.y);
    if (radiusX <= 0 || radiusY <= 0) return;
    const x = (pointerPosition.x - center.x) / radiusX;
    const y = (pointerPosition.y - center.y) / radiusY;
    setStrengthLevel(levelForDistance(Math.hypot(x, y)));
  });
}

function renderSignalArt() {
  if (!signalScene || !signalFieldLayer || !signalCoreLayer) return;
  const { x, y } = signalPosition;
  signalScene.style.transform = `rotateX(${-y * 12}deg) rotateY(${x * 17}deg)`;
  signalFieldLayer.style.transform = `translate3d(${-x * 3}px, ${-y * 2}px, 0)`;
  signalCoreLayer.style.transform = `translate3d(${x * 14}px, ${y * 9}px, 28px)`;
}

function resetSignalArt() {
  if (signalFrame !== null) window.cancelAnimationFrame(signalFrame);
  signalFrame = null;
  lastFrameTime = 0;
  signalPosition.x = 0;
  signalPosition.y = 0;
  signalPosition.targetX = 0;
  signalPosition.targetY = 0;
  renderSignalArt();
}

function suspendSignalArt() {
  resetSignalArt();
  clearStrengthInteraction();
  document.body.dataset.artPointer = "false";
}

function animateSignalArt(time) {
  signalFrame = null;
  if (document.hidden || !homeContentVisible || motionPreference.matches || !hoverPointer.matches) {
    resetSignalArt();
    return;
  }

  const elapsed = lastFrameTime ? Math.min(time - lastFrameTime, 40) : 16;
  lastFrameTime = time;
  const blend = 1 - Math.exp(-elapsed / 120);
  signalPosition.x += (signalPosition.targetX - signalPosition.x) * blend;
  signalPosition.y += (signalPosition.targetY - signalPosition.y) * blend;

  if (Math.abs(signalPosition.targetX - signalPosition.x) + Math.abs(signalPosition.targetY - signalPosition.y) < 0.001) {
    signalPosition.x = signalPosition.targetX;
    signalPosition.y = signalPosition.targetY;
    lastFrameTime = 0;
    renderSignalArt();
    return;
  }

  renderSignalArt();
  signalFrame = window.requestAnimationFrame(animateSignalArt);
}

function aimSignalArt(x, y) {
  signalPosition.targetX = Math.max(-1, Math.min(1, x));
  signalPosition.targetY = Math.max(-1, Math.min(1, y));
  if (signalFrame === null) {
    lastFrameTime = 0;
    signalFrame = window.requestAnimationFrame(animateSignalArt);
  }
}

function syncPointerMotion() {
  const canFollow = hoverPointer.matches && !motionPreference.matches && !document.hidden && homeContentVisible;
  document.body.dataset.artPointer = String(canFollow);
  if (!canFollow) resetSignalArt();
  if (!hoverPointer.matches || document.hidden) clearStrengthInteraction();
}

function syncSignalMotion() {
  document.body.dataset.scanning = String(starting);
  document.body.dataset.artActive = String(!document.hidden && !motionPreference.matches);
  syncPointerMotion();
  syncButtonRipple();
}

function syncButtonRipple() {
  const active = !starting && !startButton.disabled && !rippleDismissed &&
    !document.hidden && homeContentVisible && !motionPreference.matches &&
    ((ripplePointerInside && hoverPointer.matches) || startButton.matches(":focus-visible"));
  if (active) {
    window.clearTimeout(rippleFadeTimer);
    rippleFadeTimer = null;
    scanCtaWrap.dataset.ripple = "active";
  } else if (scanCtaWrap.dataset.ripple === "active") {
    scanCtaWrap.dataset.ripple = "fading";
    rippleFadeTimer = window.setTimeout(() => {
      scanCtaWrap.dataset.ripple = "off";
      rippleFadeTimer = null;
    }, 120);
  } else if (scanCtaWrap.dataset.ripple !== "fading") {
    scanCtaWrap.dataset.ripple = "off";
  }
}

startButton.addEventListener("pointerenter", (event) => {
  if (event.pointerType !== "mouse") return;
  ripplePointerInside = true;
  rippleDismissed = false;
  syncButtonRipple();
});
startButton.addEventListener("pointerleave", () => {
  ripplePointerInside = false;
  syncButtonRipple();
});
startButton.addEventListener("focus", () => { rippleDismissed = false; syncButtonRipple(); });
startButton.addEventListener("blur", syncButtonRipple);
startButton.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { rippleDismissed = true; syncButtonRipple(); }
});

if (homeContent && signalArt && signalScene && signalFieldLayer && signalCoreLayer && strengthToggle && signalSymbol) {
  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !hoverPointer.matches || document.hidden) return;
    pointerPosition.x = event.clientX;
    pointerPosition.y = event.clientY;
    pointerPosition.active = true;
    queueStrengthUpdate();

    if (motionPreference.matches || !homeContentVisible) return;
    if (!homeContentBounds) homeContentBounds = homeContent.getBoundingClientRect();
    if (!homeContentBounds.width || !homeContentBounds.height) return;
    const x = ((event.clientX - homeContentBounds.left) / homeContentBounds.width) * 2 - 1;
    const y = ((event.clientY - homeContentBounds.top) / homeContentBounds.height) * 2 - 1;
    aimSignalArt(x, y);
  });

  document.documentElement.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    clearStrengthInteraction();
    aimSignalArt(0, 0);
  });
  document.addEventListener("pointercancel", (event) => {
    if (event.pointerType !== "mouse") return;
    clearStrengthInteraction();
    aimSignalArt(0, 0);
  });

  strengthToggle.addEventListener("click", () => {
    pointerPosition.active = false;
    if (strengthFrame !== null) window.cancelAnimationFrame(strengthFrame);
    strengthFrame = null;
    setStrengthLevel(strengthLevel === 3 ? 1 : strengthLevel + 1);
  });

  const invalidateSignalGeometry = () => {
    homeContentBounds = null;
    signalCenter = null;
    queueStrengthUpdate();
  };
  window.addEventListener("resize", invalidateSignalGeometry);
  window.addEventListener("scroll", invalidateSignalGeometry, { passive: true });
  window.addEventListener("blur", suspendSignalArt);
  window.addEventListener("focus", syncPointerMotion);
  window.addEventListener("pagehide", suspendSignalArt);

  if (typeof ResizeObserver === "function") {
    const geometryObserver = new ResizeObserver(invalidateSignalGeometry);
    geometryObserver.observe(homeContent);
    geometryObserver.observe(signalArt);
    geometryObserver.observe(signalArt.closest(".hero"));
  }

  if (typeof IntersectionObserver === "function") {
    const signalObserver = new IntersectionObserver(([entry]) => {
      homeContentVisible = entry.isIntersecting && entry.intersectionRatio > 0;
      syncPointerMotion();
      syncButtonRipple();
    });
    signalObserver.observe(homeContent);
  }
}

startButton.addEventListener("click", async () => {
  if (starting) return;
  starting = true;
  startButton.disabled = true;
  startButton.setAttribute("aria-busy", "true");
  startButton.classList.add("is-busy");
  loadingMessage.textContent = "正在启动…";
  errorMessage.textContent = "";
  errorMessage.classList.add("is-empty");
  syncSignalMotion();
  try {
    const response = await fetch("/api/scan/start", { method: "POST" });
    const status = await response.json();
    if (!response.ok || status.scan_state !== "scanning") {
      throw new Error(status.error || "扫描未能启动，请稍后重试。");
    }
  } catch (error) {
    starting = false;
    startButton.disabled = false;
    startButton.setAttribute("aria-busy", "false");
    startButton.classList.remove("is-busy");
    loadingMessage.textContent = "";
    errorMessage.textContent = error.message || "无法连接本机服务，请稍后重试。";
    errorMessage.classList.remove("is-empty");
    syncSignalMotion();
    return;
  }

  starting = false;
  startButton.classList.remove("is-busy");
  startButton.removeAttribute("aria-busy");
  loadingMessage.textContent = "";
  suspendSignalArt();
  syncSignalMotion();
  try { window.ScanTransition?.prepare(startButton); } catch (_) { /* Visual fallback. */ }
  window.location.assign("/monitor");
});

document.addEventListener("visibilitychange", syncSignalMotion);
motionPreference.addEventListener("change", syncSignalMotion);
hoverPointer.addEventListener("change", syncSignalMotion);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  starting = false;
  startButton.disabled = false;
  startButton.removeAttribute("aria-busy");
  startButton.classList.remove("is-busy");
  startButton.style.removeProperty("view-transition-name");
  startButton.querySelector(".button-label").style.removeProperty("view-transition-name");
  document.documentElement.removeAttribute("data-scan-transition");
  document.body.removeAttribute("data-scan-handoff");
  loadingMessage.textContent = "";
  syncSignalMotion();
});
syncSignalMotion();

