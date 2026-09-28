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
let starting = false;
let signalFrame = null;
let lastFrameTime = 0;
let homeContentBounds = null;
let homeContentVisible = typeof IntersectionObserver !== "function";
const signalPosition = { x: 0, y: 0, targetX: 0, targetY: 0 };

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
}

function syncSignalMotion() {
  document.body.dataset.scanning = String(starting);
  document.body.dataset.artActive = String(!document.hidden && !motionPreference.matches);
  syncPointerMotion();
}

if (homeContent && signalArt && signalScene && signalFieldLayer && signalCoreLayer) {
  homeContent.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse" || !hoverPointer.matches || motionPreference.matches) return;
    homeContentBounds = homeContent.getBoundingClientRect();
  });

  homeContent.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !hoverPointer.matches || motionPreference.matches || !homeContentVisible) return;
    if (!homeContentBounds) homeContentBounds = homeContent.getBoundingClientRect();
    if (!homeContentBounds.width || !homeContentBounds.height) return;
    const x = ((event.clientX - homeContentBounds.left) / homeContentBounds.width) * 2 - 1;
    const y = ((event.clientY - homeContentBounds.top) / homeContentBounds.height) * 2 - 1;
    aimSignalArt(x, y);
  });

  homeContent.addEventListener("pointerleave", () => aimSignalArt(0, 0));
  homeContent.addEventListener("pointercancel", () => aimSignalArt(0, 0));

  const invalidateHomeContentBounds = () => {
    homeContentBounds = null;
    aimSignalArt(0, 0);
  };
  window.addEventListener("resize", invalidateHomeContentBounds);
  window.addEventListener("scroll", invalidateHomeContentBounds, { passive: true });
  window.addEventListener("blur", suspendSignalArt);
  window.addEventListener("focus", syncPointerMotion);
  window.addEventListener("pagehide", suspendSignalArt);

  if (typeof ResizeObserver === "function") {
    const homeContentObserver = new ResizeObserver(invalidateHomeContentBounds);
    homeContentObserver.observe(homeContent);
  }

  if (typeof IntersectionObserver === "function") {
    const signalObserver = new IntersectionObserver(([entry]) => {
      homeContentVisible = entry.isIntersecting && entry.intersectionRatio > 0;
      syncPointerMotion();
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
    window.location.assign("/monitor");
  } catch (error) {
    starting = false;
    startButton.disabled = false;
    startButton.setAttribute("aria-busy", "false");
    startButton.classList.remove("is-busy");
    loadingMessage.textContent = "";
    errorMessage.textContent = error.message || "无法连接本机服务，请稍后重试。";
    errorMessage.classList.remove("is-empty");
    syncSignalMotion();
  }
});

document.addEventListener("visibilitychange", syncSignalMotion);
motionPreference.addEventListener("change", syncSignalMotion);
hoverPointer.addEventListener("change", syncSignalMotion);
syncSignalMotion();

