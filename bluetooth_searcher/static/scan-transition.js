"use strict";

// A successful scan handoff produces one short CRT channel switch, without delaying navigation.
window.ScanTransition = (() => {
  const storageKey = "bluetooth-scan-handoff";
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let entryUntil = 0;
  let expiryTimer = null;
  let snowTimer = null;
  let screen = null;
  let incoming = false;

  function clearStorage() {
    try { sessionStorage.removeItem(storageKey); } catch (_) { /* Storage is optional. */ }
  }

  function stopSnow(focusMain = false) {
    window.clearTimeout(snowTimer);
    snowTimer = null;
    screen?.classList.remove("channel-switch");
    screen = null;
    document.documentElement.removeAttribute("data-scan-transition");
    if (focusMain && document.activeElement === document.body && !document.hidden) {
      document.getElementById("monitor")?.focus({ preventScroll: true });
    }
  }

  function expireEntry() {
    entryUntil = 0;
    window.clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function prepare() {
    clearStorage();
    if (preference.matches) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        time: Date.now(), from: location.href,
        to: new URL("/monitor", location.href).href, scanState: "scanning",
      }));
    } catch (_) { /* The next page still loads normally when storage is unavailable. */ }
  }

  function entryState() {
    return entryUntil > Date.now() ? "scanning" : null;
  }

  function onStatus(status) {
    expireEntry();
    if (status.scan_state !== "scanning") {
      incoming = false;
      stopSnow();
    }
  }

  if (location.pathname === "/monitor") {
    let handoff = null;
    try { handoff = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch (_) { /* Ignore malformed or unavailable storage. */ }
    clearStorage();
    incoming = !preference.matches && handoff?.scanState === "scanning" &&
      Number.isFinite(handoff.time) && Date.now() - handoff.time >= 0 && Date.now() - handoff.time < 5000 &&
      handoff.to === location.href && (!document.referrer || handoff.from === document.referrer);
    if (incoming) {
      entryUntil = Date.now() + 2000;
      expiryTimer = window.setTimeout(() => {
        expireEntry();
        window.dispatchEvent(new Event("scan-entry-expired"));
      }, 2000);
    }
  }

  function startIncomingSnow() {
    if (!incoming || preference.matches || document.hidden) return;
    incoming = false;
    screen = document.querySelector(".crt-screen");
    if (!screen) return;
    document.documentElement.dataset.scanTransition = "incoming";
    screen.classList.add("channel-switch");
    snowTimer = window.setTimeout(() => stopSnow(true), 249);
  }

  function switchChannel() {
    stopSnow();
    if (preference.matches || document.hidden) return;
    screen = document.querySelector(".scope-screen");
    if (!screen) return;
    const target = screen;
    requestAnimationFrame(() => {
      if (screen !== target || preference.matches || document.hidden) return;
      target.classList.add("channel-switch");
      snowTimer = window.setTimeout(() => stopSnow(), 249);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startIncomingSnow, { once: true });
  } else startIncomingSnow();
  window.addEventListener("pagehide", () => {
    incoming = false;
    expireEntry();
    stopSnow();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      incoming = false;
      stopSnow();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") stopSnow();
  });
  preference.addEventListener("change", () => {
    if (preference.matches) {
      incoming = false;
      expireEntry();
      stopSnow();
    }
  });

  return { prepare, entryState, onStatus, switchChannel };
})();
