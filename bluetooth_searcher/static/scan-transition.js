"use strict";

// The scan starts before navigation; this module only hands its visual state to /monitor.
window.ScanTransition = (() => {
  const storageKey = "bluetooth-scan-handoff";
  const duration = 600;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let entryUntil = 0;
  let transition = null;
  let animations = [];
  let expiryTimer = null;

  function clearStorage() {
    try { sessionStorage.removeItem(storageKey); } catch (_) { /* Storage is optional. */ }
  }

  function stopEntry(focusMain = false, skip = true) {
    const active = transition;
    transition = null;
    if (active && skip) active.skipTransition();
    for (const animation of animations) animation.cancel();
    animations = [];
    document.documentElement.removeAttribute("data-scan-transition");
    document.body?.removeAttribute("data-scan-handoff");
    const target = document.getElementById("startButton");
    target?.style.removeProperty("view-transition-name");
    target?.querySelector(".button-label")?.style.removeProperty("view-transition-name");
    if (focusMain && document.activeElement === document.body && !document.hidden) {
      document.getElementById("monitor")?.focus({ preventScroll: true });
    }
  }

  function prepare(button) {
    if (preference.matches || !("onpageswap" in window) || !window.CSS?.supports("view-transition-name", "scan-button")) return;
    const label = button.querySelector(".button-label");
    const rect = button.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const handoff = {
      time: Date.now(), from: location.href, to: new URL("/monitor", location.href).href,
      viewport: [innerWidth, innerHeight],
      button: [rect.left, rect.top, rect.width, rect.height],
      label: [labelRect.left, labelRect.top, labelRect.width, labelRect.height],
      scanState: "scanning",
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(handoff));
      document.documentElement.dataset.scanTransition = "outgoing";
      document.body.dataset.scanHandoff = "outgoing";
      button.style.viewTransitionName = "scan-button";
      label.style.viewTransitionName = "scan-label";
    } catch (_) { clearStorage(); }
  }

  function entryState() {
    return entryUntil > Date.now() ? "scanning" : null;
  }

  function onStatus(status) {
    entryUntil = 0;
    window.clearTimeout(expiryTimer);
    if (status.scan_state !== "scanning" && transition) stopEntry(true);
  }

  window.addEventListener("pageswap", (event) => {
    if (!event.viewTransition) return;
    // Skipping a transition rejects ready; consume it on the outgoing document.
    event.viewTransition.ready.catch(() => {});
    if (document.body?.classList.contains("home-page") &&
        document.documentElement.dataset.scanTransition === "outgoing" &&
        event.activation?.entry?.url === new URL("/monitor", location.href).href) return;
    event.viewTransition.skipTransition();
  });

  window.addEventListener("pagereveal", (event) => {
    if (!document.body?.classList.contains("monitor-page")) {
      if (event.viewTransition) {
        event.viewTransition.ready.catch(() => {});
        event.viewTransition.skipTransition();
      }
      return;
    }
    let handoff = null;
    try { handoff = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch (_) { /* Ignore stale or unavailable storage. */ }
    clearStorage();
    const activation = window.navigation?.activation;
    const valid = event.viewTransition && !preference.matches && handoff?.scanState === "scanning" &&
      Date.now() - handoff.time >= 0 && Date.now() - handoff.time < 5000 &&
      handoff.from === activation?.from?.url && handoff.to === activation?.entry?.url &&
      activation.navigationType === "push" &&
      handoff.viewport[0] === innerWidth && handoff.viewport[1] === innerHeight;
    if (!valid) {
      if (event.viewTransition) {
        event.viewTransition.ready.catch(() => {});
        event.viewTransition.skipTransition();
      }
      return;
    }

    const button = document.getElementById("startButton");
    const label = button?.querySelector(".button-label");
    if (!button || !label) {
      event.viewTransition.ready.catch(() => {});
      event.viewTransition.skipTransition();
      return;
    }
    entryUntil = Date.now() + 2000;
    expiryTimer = window.setTimeout(() => {
      entryUntil = 0;
      window.dispatchEvent(new Event("scan-entry-expired"));
    }, 2000);
    label.textContent = "扫描中";
    button.disabled = true;
    button.classList.add("is-scanning");
    document.documentElement.dataset.scanTransition = "incoming";
    document.body.dataset.scanHandoff = "incoming";
    button.style.viewTransitionName = "scan-button";
    label.style.viewTransitionName = "scan-label";
    transition = event.viewTransition;

    const animatePart = (pseudoElement, keyframes, options) => {
      const animation = document.documentElement.animate(keyframes, {
        duration, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both",
        ...options, pseudoElement,
      });
      animations.push(animation);
    };

    transition.ready.then(() => {
      if (!transition) return;
      const target = button.getBoundingClientRect();
      const targetLabel = label.getBoundingClientRect();
      const [x, y, width, height] = handoff.button;
      const [labelX, labelY] = handoff.label;
      if (!target.width || !target.height || !width || !height) { stopEntry(); return; }
      // Disabling the browser's size interpolation leaves the snapshot group at
      // the viewport origin. Move that fixed-size group between absolute points.
      const start = `translate(${x}px, ${y}px) scale(${width / target.width}, ${height / target.height})`;
      animatePart("::view-transition-group(scan-button)", [
        { transform: start }, { transform: `translate(${target.left}px, ${target.top}px) scale(1)` },
      ], { duration });
      animatePart("::view-transition-group(scan-label)", [
        { transform: `translate(${labelX}px, ${labelY}px)` },
        { transform: `translate(${targetLabel.left}px, ${targetLabel.top}px)` },
      ], { duration });
      animatePart("::view-transition-old(scan-label)", [
        { opacity: 1, offset: 0 }, { opacity: 1, offset: 80 / duration },
        { opacity: 0, offset: 200 / duration }, { opacity: 0, offset: 1 },
      ], { duration });
      animatePart("::view-transition-new(scan-label)", [
        { opacity: 0, offset: 0 }, { opacity: 0, offset: 360 / duration },
        { opacity: 1, offset: 540 / duration }, { opacity: 1, offset: 1 },
      ], { duration });
      animatePart("::view-transition-old(root)", [
        { opacity: 1, offset: 0 }, { opacity: 0, offset: 180 / duration }, { opacity: 0, offset: 1 },
      ], { duration });
      animatePart("::view-transition-new(root)", [
        { opacity: 0, transform: "translateY(8px)", offset: 0 },
        { opacity: 0, transform: "translateY(8px)", offset: 120 / duration },
        { opacity: 1, transform: "translateY(0)", offset: 420 / duration },
        { opacity: 1, transform: "translateY(0)", offset: 1 },
      ], { duration });
    }).catch(() => stopEntry());
    transition.finished.then(() => stopEntry(true, false), () => stopEntry(true, false));
  });

  const interrupt = () => { if (transition) stopEntry(); };
  window.addEventListener("resize", interrupt);
  document.addEventListener("visibilitychange", () => { if (document.hidden) interrupt(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") interrupt(); });
  preference.addEventListener("change", () => { if (preference.matches) interrupt(); });

  return { prepare, entryState, onStatus };
})();
