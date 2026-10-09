/* Cassette acceptance checks. API and WS data are simulated; no hardware scan starts. */
"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.BLUETOOTH_TEST_URL || "http://127.0.0.1:8765";
const localChrome = "C:/Users/PC/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const executablePath = process.env.BLUETOOTH_CHROME_PATH || (fs.existsSync(localChrome) ? localChrome : undefined);
const output = path.resolve(__dirname, process.env.BLUETOOTH_QA_ROOT || "cassette-refinement", "targeted");
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], errors: [], requests: [], screenshots: [], measurements: {}, validation: "Simulated HTTP/WebSocket data in headless Chromium. Visibility lifecycle and 50% zoom are emulated; real Bluetooth, native Windows browser UI, Safari, and iOS hardware are not validated here." };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, result) { assert.ok(result, name); report.checks.push(name); console.log("PASS", name); }
function device(index, now) {
  const id = `CA:02:00:00:00:${index.toString(16).padStart(2, "0")}`.toUpperCase();
  return { id, address: id, name: index === 0 ? "主通信器" : index === 1 ? "备用接收机" : "导航信标 " + index,
    last_seen_ms: now, last_rssi: [-48, -72, -94, -63][index % 4], advertised_name: null, paired_name: null, system_name: null,
    possible_brand: null, brand_source: null, company_ids: [], broadcast_companies: [], service_uuids: [] };
}
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath });
  report.measurements.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("request", request => report.requests.push(request.url()));
  const status = { scan_state: "stopped", radio_state: "on", error: null, stopped_at_ms: null, device_count: 27, fresh_count: 6 };
  let failStatus = false, rejectStart = true, startCalls = 0, statusCalls = 0, activeStatus = 0, maxActive = 0, nextDelay = 0;
  let rows = [], history = {}, channel;
  const snapshot = () => ({ type: "snapshot", status: { ...status }, devices: rows, history });
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/status") {
      statusCalls++; activeStatus++; maxActive = Math.max(maxActive, activeStatus);
      const wait = nextDelay; nextDelay = 0;
      if (wait) await sleep(wait);
      activeStatus--;
      return failStatus ? route.fulfill({ status: 503, json: { error: "服务暂不可用" } }) : route.fulfill({ json: status });
    }
    if (pathname.endsWith("/start")) {
      startCalls++;
      await sleep(350);
      if (rejectStart) return route.fulfill({ status: 409, json: { ...status, scan_state: "error", error: "适配器测试故障，请重试。" } });
      Object.assign(status, { scan_state: "scanning", error: null });
    } else Object.assign(status, { scan_state: "stopped", stopped_at_ms: Date.now() });
    return route.fulfill({ json: status });
  });
  await page.routeWebSocket("**/ws", socket => { channel = socket; socket.send(JSON.stringify(snapshot())); });
  async function shot(name) { await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true }); report.screenshots.push(name + ".png"); }
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector("#homeDeviceCount")?.textContent.includes("27"));
  check("home shows genuine API device and fresh counts", await page.evaluate(() => document.querySelector("#homeDeviceCount").textContent.includes("27") && document.querySelector("#homeFreshCount").textContent.includes("6")));
  check("old demo signal and custom cursor are removed", await page.locator("#strengthToggle, #signalScene, .scan-ripple-layer").count() === 0 && await page.evaluate(() => !getComputedStyle(document.body).cursor.includes("url(")));
  report.measurements.crt = await page.evaluate(() => {
    const screen = document.querySelector(".crt-screen"), raster = screen.querySelector(".crt-scan-pass");
    const face = getComputedStyle(screen), lines = getComputedStyle(screen, "::before"), noise = getComputedStyle(screen, "::after"), sweep = getComputedStyle(raster);
    return { radius: face.borderRadius, edgeShadow: face.boxShadow, lineImage: lines.backgroundImage, lineOpacity: Number(lines.opacity), noiseOpacity: Number(noise.opacity),
      raster: { duration: sweep.animationDuration, delay: sweep.animationDelay, steps: sweep.animationTimingFunction, iterations: sweep.animationIterationCount, decorative: raster.getAttribute("aria-hidden"), pointerEvents: sweep.pointerEvents },
      animatedProperties: [...new Set(document.getAnimations().flatMap(animation => animation.effect.getKeyframes().flatMap(frame => Object.keys(frame).filter(key => !["offset", "computedOffset", "easing", "composite"].includes(key)))))] };
  });
  check("CRT has stronger static scan lines, noise and curved inset glass", report.measurements.crt.lineOpacity >= .5 && report.measurements.crt.noiseOpacity >= .06 && report.measurements.crt.lineImage.includes("repeating-linear-gradient") && parseFloat(report.measurements.crt.radius) >= 20 && report.measurements.crt.edgeShadow.includes("inset"));
  const raster = report.measurements.crt.raster;
  check("raster is a finite decorative stepped compositor pass", raster.duration === "3s" && raster.iterations === "1" && raster.steps.includes("steps(36") && raster.decorative === "true" && raster.pointerEvents === "none" && report.measurements.crt.animatedProperties.every(property => ["transform", "opacity"].includes(property)));
  const initialCalls = statusCalls;
  Object.assign(status, { device_count: 30, fresh_count: 7, radio_state: "off", scan_state: "error" });
  await page.waitForTimeout(2200);
  check("visible home polls status every two seconds", statusCalls >= initialCalls + 1 && statusCalls <= initialCalls + 2);
  check("poll updates real counts, radio and scan readouts", await page.evaluate(() => document.querySelector("#homeDeviceCount").textContent === "30" && document.querySelector("#homeFreshCount").textContent === "7" && document.querySelector("#homeRadio").dataset.state === "off" && document.querySelector("#homeScan").dataset.state === "error"));
  Object.assign(status, { device_count: 27, fresh_count: 6, radio_state: "on", scan_state: "stopped" });
  nextDelay = 3100;
  const beforeSlow = statusCalls;
  await page.waitForTimeout(6100);
  check("status polling never overlaps slow requests", statusCalls > beforeSlow && maxActive === 1);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(100);
  const hiddenCalls = statusCalls;
  await page.waitForTimeout(2400);
  check("hidden lifecycle pauses new polling requests", statusCalls === hiddenCalls);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(300);
  check("visible lifecycle immediately refreshes status", statusCalls === hiddenCalls + 1);
  failStatus = true;
  await page.waitForFunction(() => document.querySelector("#retryStatusButton") && !document.querySelector("#retryStatusButton").hidden);
  check("status failure offers an accessible retry action", await page.locator("#retryStatusButton").isVisible() && await page.locator("#retryStatusButton").isEnabled());
  failStatus = false;
  await page.locator("#retryStatusButton").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#retryStatusButton").hidden);
  check("keyboard retry restores real status", await page.locator("#homeDeviceCount").innerText() === "27");
  nextDelay = 1800;
  const beforeStale = statusCalls;
  while (statusCalls === beforeStale) await sleep(50);
  await page.locator("#startButton").focus();
  const width = (await page.locator("#startButton").boundingBox()).width;
  await page.keyboard.press("Enter");
  await page.evaluate(() => { document.querySelector("#startButton").click(); document.querySelector("#startButton").click(); });
  check("duplicate start stays guarded with original label and spinner", startCalls === 1 && await page.locator("#startButton").isDisabled() && await page.locator("#startButton .button-spinner").isVisible() && (await page.locator("#startButton .button-label").innerText()) === "开始扫描" && Math.abs((await page.locator("#startButton").boundingBox()).width - width) < 1);
  await page.locator("#homeError").waitFor({ state: "visible" });
  check("start failure preserves home and permits retry", new URL(page.url()).pathname === "/" && await page.locator("#startButton").isEnabled() && (await page.locator("#homeError").innerText()).includes("适配器测试故障"));
  await page.waitForTimeout(1900);
  check("aborted stale GET and fresh polls cannot erase POST failure", (await page.locator("#homeError").innerText()).includes("适配器测试故障"));
  await shot("home-error");
  rejectStart = false;
  await page.locator("#startButton").click();
  await page.waitForURL(base + "/monitor");
  check("successful start enters monitor", await page.locator("#signalChart").count() === 1);

  const now = Date.now(); rows = Array.from({ length: 4 }, (_, index) => device(index, now));
  history = Object.fromEntries(rows.map(item => [item.id, Array.from({ length: 8 }, (_, index) => ({ time_ms: now - (7 - index) * 1000, rssi: item.last_rssi + index % 3 }))]));
  channel.send(JSON.stringify(snapshot()));
  await page.waitForFunction(() => document.querySelectorAll(".device-card").length === 4);
  check("RSSI bars use twelve distinct segments and readable units", await page.evaluate(() => [...document.querySelectorAll(".device-card")].every(card => card.querySelectorAll(".signal-segment").length === 12 && /dBm/.test(card.textContent) && /强|中|弱/.test(card.querySelector(".strength-label").textContent))));
  check("history data stays collapsed by default", !await page.locator("#dataPanel").evaluate(node => node.open));
  await page.locator("#windowKnob").focus();
  await page.keyboard.press("Enter");
  check("Enter switches knob to five minutes and URL state", await page.evaluate(() => windowSeconds === 300 && !document.querySelector("#windowKnob").hasAttribute("aria-pressed") && document.querySelector("#windowKnob").getAttribute("aria-label").includes("当前时间范围 5 分钟") && document.querySelector(".knob-detent[data-detent='300']").classList.contains("active") && new URLSearchParams(location.search).get("window") === "300"));
  await page.keyboard.press("Space");
  check("Space switches knob back to sixty seconds", await page.evaluate(() => windowSeconds === 60 && !document.querySelector("#windowKnob").hasAttribute("aria-pressed") && document.querySelector("#windowKnob").getAttribute("aria-label").includes("当前时间范围 60 秒") && document.querySelector(".knob-detent[data-detent='60']").classList.contains("active")));
  check("time range has one physical control with static detents", await page.locator("[data-window]").count() === 0 && await page.locator("#timeRange button").count() === 1 && await page.locator(".knob-detent").count() === 2);
  await page.keyboard.press("ArrowRight");
  check("ArrowRight directly selects five minutes", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "300");
  const unchanged = await page.evaluate(() => ({ length: history.length, search: location.search }));
  await page.keyboard.press("End");
  check("same range keyboard selection preserves navigation state", await page.evaluate(before => history.length === before.length && location.search === before.search, unchanged));
  await page.keyboard.press("Home");
  check("Home directly selects sixty seconds", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "60");
  await page.keyboard.press("ArrowUp");
  check("ArrowUp selects the longer range", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "300");
  await page.keyboard.press("ArrowDown");
  check("ArrowDown selects the shorter range", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "60");
  await page.locator("#windowKnob").click();
  check("physical knob click toggles range", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "300");
  await page.goBack();
  await page.waitForFunction(() => windowSeconds === 60);
  check("Back synchronizes static detents and knob", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "60" && await page.locator(".knob-detent[data-detent='60']").evaluate(node => node.classList.contains("active")));
  await page.goForward();
  await page.waitForFunction(() => windowSeconds === 300);
  check("Forward synchronizes static detents and knob", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "300" && await page.locator(".knob-detent[data-detent='300']").evaluate(node => node.classList.contains("active")));
  await page.locator(".compare-control input").nth(1).focus();
  await page.keyboard.press("Space");
  check("physical compare toggle keeps native keyboard checkbox semantics", await page.locator(".compare-control input").nth(1).isChecked());
  await page.locator(".compare-control input").nth(2).check(); await page.locator(".compare-control input").nth(3).check();
  await page.waitForFunction(() => chart.data.datasets.length === 4);
  report.measurements.curves = await page.evaluate(() => chart.data.datasets.map(dataset => ({ color: dataset.borderColor, dash: dataset.borderDash })));
  check("four curves retain separate cassette colors and line patterns", new Set(report.measurements.curves.map(item => item.color)).size === 4 && new Set(report.measurements.curves.map(item => JSON.stringify(item.dash))).size === 4 && !report.measurements.curves.some(item => /^#(?:ff0000|f00)$/i.test(item.color)));
  report.measurements.curveContrast = await page.evaluate(() => {
    const luminance = channels => channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const screen = getComputedStyle(document.querySelector(".scope-screen")).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number);
    return chart.data.datasets.map(dataset => { const foreground = dataset.borderColor.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16)); const values = [luminance(foreground), luminance(screen)].sort((a, b) => b - a); return { color: dataset.borderColor, screen, ratio: (values[0] + .05) / (values[1] + .05) }; });
  });
  check("rendered CRT curve colors exceed 3:1 contrast", report.measurements.curveContrast.every(item => item.ratio >= 3));
  await page.locator("#chartLegend button").first().focus(); await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("#chartLegend button").getAttribute("aria-pressed") === "false");
  check("chart has native keyboard legend buttons", await page.locator("#chartLegend button").first().getAttribute("aria-pressed") === "false");
  await page.locator("#windowKnob").focus();
  report.measurements.focus = await page.locator("#windowKnob").evaluate(node => { const style = getComputedStyle(node); return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor }; });
  check("knob keyboard focus is visible", report.measurements.focus.outlineStyle !== "none" && parseFloat(report.measurements.focus.outlineWidth) >= 2);
  await page.waitForTimeout(3300);
  check("decorative motion settles with no persistent loop", await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && !animation.effect.target.closest(".is-busy")).length === 0 && Number(getComputedStyle(document.querySelector(".crt-scan-pass")).opacity) === 0));
  await shot("monitor-four-curves-1440");

  for (const width of [320, 375, 768, 1024, 1440, 2880]) {
    await page.setViewportSize({ width, height: 960 }); await page.waitForTimeout(200);
    const layout = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) }; };
      return { overflow: document.documentElement.scrollWidth > innerWidth, device: box(".device-panel"), chart: box(".chart-panel"), detail: box(".detail-panel") };
    });
    report.measurements["layout" + width] = layout;
    check(`monitor fits ${width}px`, !layout.overflow);
    if (width >= 1200) check(`${width}px uses RX-SCOPE-ID three columns`, layout.device.x < layout.chart.x && layout.chart.x < layout.detail.x && Math.abs(layout.chart.y - layout.detail.y) < 5);
    else if (width >= 768) check(`${width}px places ID below SCOPE`, layout.device.x < layout.chart.x && Math.abs(layout.chart.x - layout.detail.x) < 5 && layout.detail.y > layout.chart.y);
    else check(`${width}px stacks RX-SCOPE-ID`, Math.abs(layout.device.x - layout.chart.x) < 5 && layout.chart.y > layout.device.y && layout.detail.y > layout.chart.y);
    await shot("monitor-" + width);
    await page.goto(base); await page.waitForTimeout(1700);
    check(`home fits ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot("home-" + width);
    await page.goto(base + "/monitor"); await page.waitForFunction(() => document.querySelector("#connection").classList.contains("online"));
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => { document.documentElement.style.zoom = ".5"; });
  report.measurements.zoom50 = await page.evaluate(() => ({ zoom: getComputedStyle(document.documentElement).zoom, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, deviceWidth: document.querySelector(".device-panel").getBoundingClientRect().width }));
  check("50% zoom emulation has no overflow", report.measurements.zoom50.scrollWidth <= report.measurements.zoom50.width);
  await shot("monitor-zoom50");
  await page.evaluate(() => document.documentElement.style.removeProperty("zoom"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base); await page.waitForTimeout(100);
  check("reduced motion disables CRT and step animations", await page.evaluate(() => document.getAnimations().length === 0 && getComputedStyle(document.querySelector(".crt-scan-pass")).display === "none" && [...document.querySelectorAll(".crt-screen, .crt-screen *")].every(node => getComputedStyle(node).animationName === "none")));
  check("reduced motion title appears complete immediately", await page.evaluate(() => { const node = document.querySelector("#terminalTitle"); return node && node.textContent.trim().length > 0 && node.getAttribute("aria-hidden") === "true"; }));
  await shot("home-reduced-motion");
  await page.goto(base + "/monitor");
  check("reduced monitor has no animated decorative loops", await page.evaluate(() => document.getAnimations().length === 0));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const fontContext = await browser.newContext({ viewport: { width: 320, height: 812 } });
  const fontPage = await fontContext.newPage();
  await fontPage.route("**/*.woff2", route => route.abort());
  await fontPage.route("**/api/status", route => route.fulfill({ json: status }));
  await fontPage.routeWebSocket("**/ws", socket => socket.send(JSON.stringify(snapshot())));
  await fontPage.goto(base); await fontPage.waitForTimeout(1700);
  check("failed local fonts retain readable fallback and fit narrow home", await fontPage.locator("#startButton").isVisible() && await fontPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth && !document.fonts.check('16px "IBM Plex Mono"')));
  await fontPage.screenshot({ path: path.join(output, "home-font-fallback-320.png"), fullPage: true });
  report.screenshots.push("home-font-fallback-320.png");
  await fontPage.goto(base + "/monitor");
  await fontPage.waitForFunction(() => document.querySelectorAll(".device-card").length === 4);
  check("font fallback retains monitor controls and narrow layout", await fontPage.locator("#windowKnob").isVisible() && await fontPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fontPage.screenshot({ path: path.join(output, "monitor-font-fallback-320.png"), fullPage: true });
  report.screenshots.push("monitor-font-fallback-320.png");
  await fontContext.close();
  await page.evaluate(() => document.fonts.ready);
  check("local IBM Plex Mono loads without external runtime requests", await page.evaluate(() => document.fonts.check('16px "IBM Plex Mono"')) && report.requests.every(url => new URL(url).origin === new URL(base).origin));
  check("both pages declare dark native controls and matching theme color", await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme.includes("dark") && document.querySelector('meta[name="theme-color"]').content.toLowerCase() === "#252a27"));
  check("no browser script errors", report.errors.length === 0);
  await context.close();
})().catch(error => { report.failure = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log("checks", report.checks.length);
});
