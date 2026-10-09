/* Impeccable refinement regression checks. All BLE samples are synthetic. */
"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = process.env.BLUETOOTH_TEST_URL || "http://127.0.0.1:8765";
const output = path.resolve(__dirname, "impeccable");
const review = path.resolve(__dirname, "../.impeccable/review");
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(review, { recursive: true });
const report = { checks: [], errors: [], measurements: {}, screenshots: [], validation: "Headless Chromium with mocked HTTP and WebSocket BLE data. Touch cancellation is a synthetic event, not physical hardware. No real scan starts." };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); console.log("PASS", name); };
const now = Date.now();
let rows = Array.from({ length: 4 }, (_, index) => ({
  id: `CA:08:00:00:00:0${index}`, address: `CA:08:00:00:00:0${index}`,
  name: ["示例接收机 / 模拟数据", "示例导航信标", "示例辅助终端", "示例远端信号"][index],
  last_seen_ms: now, last_rssi: [-48, -67, -77, -92][index], company_ids: [],
  broadcast_companies: [], service_uuids: [],
}));
let status = { scan_state: "scanning", radio_state: "on", error: null, stopped_at_ms: null, device_count: 4, fresh_count: 4 };
let history = Object.fromEntries(rows.map(item => [item.id, Array.from({ length: 70 }, (_, index) => ({ time_ms: now - (69 - index) * 600, rssi: item.last_rssi + Math.round(Math.sin(index / 6) * 4) }))]));
let channel, browser;
const snapshot = () => ({ type: "snapshot", status, devices: rows, history });
const query = "?" + rows.map(item => "compare=" + encodeURIComponent(item.id)).join("&") + "&focus=" + encodeURIComponent(rows[0].id);
async function shot(page, name) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
  report.screenshots.push(name + ".png");
}
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BLUETOOTH_CHROME_PATH || "C:/Users/PC/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe" });
  report.measurements.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ json: status }));
  await page.routeWebSocket("**/ws", socket => { channel = socket; socket.send(JSON.stringify(snapshot())); });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector("#homeDeviceCount").textContent === "4");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3400);
  await shot(page, "home-1440");
  await page.setViewportSize({ width: 320, height: 812 });
  await shot(page, "home-320");
  check("home text selection uses the amber console palette", await page.evaluate(() => getComputedStyle(document.querySelector("h1"), "::selection").backgroundColor === "rgb(255, 178, 62)"));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(base + "/monitor" + query);
  await page.waitForFunction(() => chart.data.datasets.length === 4 && document.querySelectorAll(".device-card").length === 4);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await context.newCDPSession(page);
  const tree = await cdp.send("Accessibility.getFullAXTree");
  const button = tree.nodes.find(node => node.role?.value === "button" && node.name?.value === "查看 示例接收机 / 模拟数据 的详情");
  check("Chromium accessibility tree exposes RSSI, strength and address as device description", button?.description?.value.includes("-48 dBm") && button.description.value.includes("强信号") && button.description.value.includes(rows[0].address));
  check("detail module provides last measured RSSI as text", (await page.locator("#detailContent").innerText()).includes("上次信号强度") && (await page.locator("#detailContent").innerText()).includes("-48"));
  check("weak numeric reading shares the orange bar semantics", await page.locator('[data-device-id="CA:08:00:00:00:03"] .signal-value').evaluate(node => getComputedStyle(node).color === "rgb(240, 139, 72)"));
  const beforeId = await page.locator(".device-reading").first().getAttribute("id");
  const beforeNode = await page.locator(".device-open").first().evaluate(node => { window.verifiedDeviceNode = node; return true; });
  rows[0].last_rssi = -51;
  channel.send(JSON.stringify(snapshot()));
  await page.waitForFunction(() => document.querySelector(".device-reading").textContent.includes("-51 dBm"));
  check("live readout refresh retains device node and description ID", beforeNode && await page.locator(".device-reading").first().getAttribute("id") === beforeId && await page.locator(".device-open").first().evaluate(node => node === window.verifiedDeviceNode));
  await page.locator("#windowKnob").focus();
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.querySelector(".scope-screen").classList.contains("channel-switch"));
  check("range knob triggers one 12-fps snow burst and retains keyboard focus", await page.evaluate(() => {
    const effect = getComputedStyle(document.querySelector(".scope-screen"), "::after");
    return effect.animationDuration === "0.25s" && effect.animationTimingFunction.includes("steps(3") && document.activeElement.id === "windowKnob" && windowSeconds === 300;
  }));
  await page.waitForTimeout(320);
  check("range snow ends without changing chart data", await page.evaluate(() => !document.querySelector(".channel-switch") && chart.data.datasets.length === 4));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Home");
  check("reduced motion disables range snow while keeping range selection", await page.evaluate(() => !document.querySelector(".channel-switch") && windowSeconds === 60));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#dataPanel summary").click();
  await page.waitForFunction(() => document.querySelector("#dataRows").children.length === 50);
  await page.locator("#nextPage").focus();
  await page.keyboard.press("Enter");
  check("data pagination reports the new page through a polite live region", await page.evaluate(() => {
    const result = document.querySelector("#pageStatus");
    return result.getAttribute("role") === "status" && result.getAttribute("aria-live") === "polite" && result.textContent.startsWith("第 2 /");
  }));
  await page.locator("#dataPanel summary").click();
  for (const legend of await page.locator(".legend-button").all()) await legend.click();
  await page.waitForFunction(() => !document.querySelector("#chartEmpty").hidden);
  check("all hidden traces show the explicit legend recovery", (await page.locator("#chartEmpty").innerText()).includes("曲线已全部隐藏"));
  for (const legend of await page.locator(".legend-button").all()) await legend.click();
  await page.waitForFunction(() => document.querySelector("#chartEmpty").hidden);
  await page.evaluate(() => document.querySelector("#deviceList").dispatchEvent(new Event("touchstart")));
  check("synthetic touch starts list interaction guard", await page.evaluate(() => listTouching));
  await page.evaluate(() => document.querySelector("#deviceList").dispatchEvent(new Event("touchcancel")));
  check("touchcancel releases sorting guard", await page.evaluate(() => !listTouching && !listHovered));
  await page.evaluate(() => { document.querySelector("#deviceList").dispatchEvent(new Event("touchstart")); window.dispatchEvent(new Event("blur")); });
  check("lost window focus also releases list interaction guard", await page.evaluate(() => !listTouching));
  await page.waitForTimeout(3400);
  await shot(page, "monitor-1440");
  fs.copyFileSync(path.join(output, "monitor-1440.png"), path.join(review, "desktop.png"));
  fs.copyFileSync(path.join(output, "home-1440.png"), path.join(review, "home-desktop.png"));
  report.measurements.layouts = [];
  for (const width of [320, 390, 768, 1024, 1440, 2880]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(100);
    report.measurements.layouts.push(await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, inputSize: parseFloat(getComputedStyle(document.querySelector("#searchInput")).fontSize), knob: document.querySelector("#windowKnob").getBoundingClientRect().height })));
    if (width === 320 || width === 390) await shot(page, "monitor-" + width);
  }
  fs.copyFileSync(path.join(output, "monitor-390.png"), path.join(review, "mobile.png"));
  fs.copyFileSync(path.join(output, "monitor-320.png"), path.join(review, "user-320.png"));
  fs.copyFileSync(path.join(output, "home-320.png"), path.join(review, "home-mobile.png"));
  check("six monitor layouts retain no page overflow, 16px inputs and 44px knob", report.measurements.layouts.every(item => !item.overflow && item.inputSize >= 16 && item.knob >= 44));
  await page.setViewportSize({ width: 320, height: 960 });
  report.measurements.compactStatuses = await page.evaluate(() => {
    const originalBusy = busy, originalState = currentStatus.scan_state;
    const readings = [];
    for (const [operation, state] of [[false, "scanning"], ["start", "stopped"], ["stop", "scanning"], [false, "error"]]) {
      busy = operation; currentStatus.scan_state = state; renderStatus();
      const element = document.querySelector("#scanMetric"), range = document.createRange();
      range.selectNodeContents(element);
      readings.push({ text: element.textContent, lines: range.getClientRects().length });
    }
    busy = originalBusy; currentStatus.scan_state = originalState; renderStatus();
    return readings;
  });
  check("320px SYS keeps scanning, starting, stopping and error states on one line", report.measurements.compactStatuses.every(item => item.lines === 1));
  await page.setViewportSize({ width: 1440, height: 960 });
  channel.close();
  await page.waitForFunction(() => !connected && !statusReceived);
  check("disconnected adapter becomes unknown instead of showing cached green state", await page.locator("#radioMetric").innerText() === "未知" && await page.locator("#radioMetric").getAttribute("data-state") === "unknown");
  await shot(page, "monitor-disconnected");
  rows = []; history = {}; status = { ...status, device_count: 0, fresh_count: 0 };
  await page.goto(base + "/monitor?compare=");
  await page.waitForFunction(() => connected && statusReceived && document.querySelector("#emptyTitle").textContent.includes("等待附近设备"));
  check("scanning empty state asks to wait for BLE broadcasts", (await page.locator("#emptyTitle").innerText()).includes("等待附近设备"));
  status = { ...status, scan_state: "stopped", stopped_at_ms: Date.now() };
  channel.send(JSON.stringify(snapshot()));
  await page.waitForFunction(() => document.querySelector("#emptyTitle").textContent.includes("点击“开始扫描”"));
  check("idle empty state offers the enabled scan action", await page.locator("#startButton").isEnabled());
  await page.locator("#searchInput").fill("不存在的示例设备");
  await page.waitForFunction(() => document.querySelector("#emptyTitle").textContent.includes("没有匹配"));
  check("empty search keeps a useful correction instruction", (await page.locator("#emptyTitle").innerText()).includes("修改搜索内容"));
  check("no browser script errors", report.errors.length === 0);
  await context.close();
})().catch(error => { report.failure = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log("checks", report.checks.length);
});
