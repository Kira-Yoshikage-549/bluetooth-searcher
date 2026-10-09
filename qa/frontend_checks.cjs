/* Two-page UI acceptance test. Requires an installed Playwright and Chromium.
   All scan requests and WebSocket messages are mocked; no real hardware scan starts. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.BLUETOOTH_TEST_URL || "http://127.0.0.1:8765";
const output = path.resolve(__dirname, process.env.BLUETOOTH_QA_ROOT || "cassette-refinement", "two-page");
const localChrome = "C:/Users/PC/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const executablePath = process.env.BLUETOOTH_CHROME_PATH || (fs.existsSync(localChrome) ? localChrome : undefined);
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], errors: [], viewports: [], performance: null };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); console.log("PASS", name); }
function makeDevice(index, now) {
  const id = "CA:00:00:00:00:" + index.toString(16).padStart(2, "0").toUpperCase();
  return { id, address: id, name: index === 0 ? "我的蓝牙耳机" : index === 1 ? "客厅音箱" : index === 2 ? "一个名字非常长的附近蓝牙设备 <img src=x onerror=window.bad=true>" : "设备 " + index,
    last_seen_ms: now, last_rssi: -46 - index % 48, advertised_name: null, paired_name: null, system_name: null,
    possible_brand: null, brand_source: null, company_ids: [76], broadcast_companies: ["Apple, Inc."], service_uuids: [],
  };
}
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on("pageerror", error => report.errors.push(error.message));
  const state = { scan_state: "stopped", radio_state: "on", error: null, stopped_at_ms: null };
  let rows = [], history = {}, channels = [], rejectStart = true;
  const snapshot = () => ({ type: "snapshot", status: { ...state }, devices: rows, history });
  const send = message => channels.at(-1).send(JSON.stringify(message));
  const delta = (changed = [], samples = [], removed = []) => send({
    type: "delta", status: { ...state }, devices: changed,
    samples: Object.fromEntries(samples.map(([id, sample]) => [id, [sample]])), removed,
  });
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/status") return route.fulfill({ json: state });
    await sleep(300);
    if (pathname.endsWith("/start")) {
      if (rejectStart) Object.assign(state, { scan_state: "error", radio_state: "off", error: "电脑蓝牙已关闭，请先开启后重试。" });
      else Object.assign(state, { scan_state: "scanning", radio_state: "on", error: null, stopped_at_ms: null });
    } else Object.assign(state, { scan_state: "stopped", error: null, stopped_at_ms: Date.now() });
    await route.fulfill({ status: rejectStart && pathname.endsWith("/start") ? 409 : 200, json: state });
    if (channels.length) delta();
  });
  await page.routeWebSocket("**/ws", channel => {
    channels.push(channel);
    channel.send(JSON.stringify(snapshot()));
  });
  await page.goto(base + "/");
  check("home has only entry content", await page.locator("canvas, #deviceList, #scanMetric").count() === 0);
  check("home exposes real readouts and monitor navigation", await page.locator("#homeRadio, #homeScan, #homeDeviceCount").count() === 3 && await page.locator("a[href='/monitor']").count() > 0);
  await page.waitForTimeout(750);
  await page.screenshot({ path: path.join(output, "home-1440.png") });
  const startWidth = (await page.locator("#startButton").boundingBox()).width;
  await page.locator("#startButton").click();
  check("home start shows busy state before response", await page.locator("#startButton").isDisabled() && new URL(page.url()).pathname === "/");
  check("loading keeps button label and width", await page.locator("#startButton").innerText() === "开始扫描" && Math.abs((await page.locator("#startButton").boundingBox()).width - startWidth) < 1 && (await page.locator("#homeLoading").innerText()).includes("正在启动"));
  await page.locator("#homeError").waitFor({ state: "visible" });
  check("failed start stays home with a clear error", new URL(page.url()).pathname === "/" && (await page.locator("#homeError").innerText()).includes("电脑蓝牙已关闭"));
  check("home start is retryable", await page.locator("#startButton").isEnabled());
  await page.screenshot({ path: path.join(output, "home-error-1440.png") });
  rejectStart = false;
  await page.locator("#startButton").click();
  await page.waitForURL(base + "/monitor");
  check("successful start navigates to monitor", await page.locator("#signalChart").count() === 1);
  await page.waitForFunction(() => document.querySelector("#connection").classList.contains("online"));
  await page.waitForFunction(() => document.querySelector("#scanMetric").textContent === "扫描中");
  check("monitor exposes instrument headings", await page.locator("#deviceTitle, #chartTitle, #detailTitle").count() === 3);
  check("neutral notice is hidden", await page.locator("#notice").isHidden());
  await page.waitForTimeout(750);
  await page.screenshot({ path: path.join(output, "monitor-empty-1440.png") });
  const now = Date.now();
  rows = Array.from({ length: 120 }, (_, index) => makeDevice(index, now));
  history = Object.fromEntries(rows.map(item => [item.id, [{ time_ms: now, rssi: item.last_rssi }]]));
  send(snapshot());
  await page.waitForFunction(() => document.querySelector("#deviceTotal").textContent === "120" && document.querySelectorAll(".device-card").length > 0);
  check("120 devices are available with bounded card DOM", await page.locator(".device-card").count() < 25);
  check("live devices render and first is selected", await page.locator(".compare-control input:checked").count() === 1);
  check("untrusted names are text", await page.locator(".device-card img").count() === 0 && !await page.evaluate(() => window.bad));
  await page.locator("#searchInput").fill("客厅音箱");
  await page.waitForTimeout(250);
  check("search remains available", await page.locator(".device-card:visible").count() === 1);
  await page.locator("#searchInput").fill("");
  await page.locator("#sortSelect").selectOption("name");
  await page.locator("#sortSelect").selectOption("strength");
  await page.waitForTimeout(250);
  for (let i = 1; i <= 3; i++) await page.locator('.device-card[data-device-id="' + rows[i].id + '"] input').check();
  await page.locator('.device-card[data-device-id="' + rows[4].id + '"] input').check().catch(() => {});
  await page.waitForTimeout(250);
  check("four-device limit remains enforced", await page.evaluate((fifth) => selected.length === 4 && !selected.includes(fifth), rows[4].id) && await page.locator("#notice").isVisible());
  await page.locator("#windowKnob").click();
  check("five-minute chart range works", await page.locator("#windowKnob").getAttribute("data-window-seconds") === "300");
  await page.evaluate(() => {
    window.previousCards = [...document.querySelectorAll(".device-card")];
    document.querySelector(".device-card input").focus();
    window.previousFocus = document.activeElement;
  });
  for (let i = 0; i < 25; i++) {
    const time = Date.now();
    rows.forEach((item, index) => { item.last_seen_ms = time; item.last_rssi = -50 - index % 40 + i % 4; });
    delta(rows, rows.map(item => [item.id, { time_ms: time, rssi: item.last_rssi }]));
    await sleep(200);
  }
  report.performance = await page.evaluate(() => ({
    cards: document.querySelectorAll(".device-card").length,
    reused: window.previousCards.some((node) => node.isConnected && node.contains(window.previousFocus)),
    focusRetained: document.activeElement === window.previousFocus,
  }));
  check("windowed updates reuse mounted nodes and retain keyboard focus", report.performance.cards < 25 && report.performance.reused && report.performance.focusRetained);
  await page.screenshot({ path: path.join(output, "monitor-live-1440.png") });
  await page.locator("#stopButton").click();
  await page.waitForFunction(() => currentStatus.scan_state === "stopped" && chart.options.scales.x.max === currentStatus.stopped_at_ms);
  check("stop keeps the monitor page", new URL(page.url()).pathname === "/monitor");
  const before = await page.evaluate(() => ({ end: chart.options.scales.x.max, sampleCount: [...histories.values()].reduce((sum, items) => sum + items.length, 0) }));
  await sleep(1250);
  check("stopped history stays fixed", await page.evaluate(previous => chart.options.scales.x.max === previous.end && [...histories.values()].reduce((sum, items) => sum + items.length, 0) === previous.sampleCount, before));
  const oldChannelCount = channels.length;
  channels.at(-1).close();
  await page.waitForFunction(() => document.querySelector("#connection").textContent.includes("重连"));
  await page.waitForFunction(() => document.querySelector("#connection").classList.contains("online"));
  check("WebSocket reconnect works on monitor", channels.length > oldChannelCount);
  await page.locator(".brand").click();
  await page.waitForURL(base + "/");
  check("brand returns to clean home", await page.locator("#signalChart").count() === 0 && await page.locator("#startButton").isVisible());
  for (const width of [1440, 1024, 768, 375, 320, 2880]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(700);
    const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: path.join(output, "home-" + width + ".png") });
    await page.goto(base + "/monitor");
    await page.waitForTimeout(700);
    const monitorOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    report.viewports.push({ width, homeOverflow, monitorOverflow });
    check("both pages fit " + width + "px", !homeOverflow && !monitorOverflow);
    await page.screenshot({ path: path.join(output, "monitor-" + width + ".png") });
    await page.goto(base + "/");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  check("home honours reduced motion", await page.evaluate(() => [...document.querySelectorAll(".crt-screen, .crt-screen *")].every(node => getComputedStyle(node).animationName === "none")));
  check("no browser script errors", report.errors.length === 0);
  await context.close();
})().catch(error => { report.failure = error.stack; console.error(error); process.exitCode = 1; })
.finally(async () => {
  if (browser) await browser.close();
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log("checks", report.checks.length);
});

