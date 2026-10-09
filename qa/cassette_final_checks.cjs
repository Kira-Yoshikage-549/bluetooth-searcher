/* Final font/contrast checks and genuine Chromium preference zoom in isolated profiles. */
"use strict";
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const base = process.env.BLUETOOTH_TEST_URL || "http://127.0.0.1:8765";
const localChrome = "C:/Users/PC/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const executablePath = process.env.BLUETOOTH_CHROME_PATH || (fs.existsSync(localChrome) ? localChrome : undefined);
const output = path.resolve(__dirname, process.env.BLUETOOTH_QA_ROOT || "cassette-refinement", "final");
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], errors: [], measurements: {}, screenshots: [], validation: "Mocked HTTP/WebSocket data. Native Chromium zoom uses fresh temporary profiles and partition.default_zoom_level; CSS zoom and page-scale emulation are not applied. No existing browser profile is used or modified; no real hardware scan starts." };
const tempRoot = path.resolve(os.tmpdir());
const profileRoot = fs.mkdtempSync(path.join(tempRoot, "bluetooth-cassette-zoom-"));
function check(name, value) { assert.ok(value, name); report.checks.push(name); console.log("PASS", name); }
const now = Date.now();
const rows = Array.from({ length: 120 }, (_, index) => {
  const id = `CA:03:00:00:00:${index.toString(16).padStart(2, "0")}`.toUpperCase();
  return { id, address: id, name: index === 0 ? "主通信器：非常长的中文设备名称用于验证字符回退与窄屏截断" : "导航信标 " + index,
    last_seen_ms: now, last_rssi: -46 - index % 48, advertised_name: null, paired_name: null, system_name: null,
    possible_brand: null, brand_source: null, company_ids: [], broadcast_companies: [], service_uuids: [] };
});
const history = Object.fromEntries(rows.map(item => [item.id, Array.from({ length: 12 }, (_, index) => ({ time_ms: now - (11 - index) * 1000, rssi: item.last_rssi + index % 4 }))]));
const status = { scan_state: "scanning", radio_state: "on", error: null, stopped_at_ms: null, fresh_count: 120, device_count: 120 };
const query = "?" + rows.slice(0, 4).map(item => "compare=" + encodeURIComponent(item.id)).join("&");
let context;
async function mock(page, preview = false) {
  page.on("pageerror", error => report.errors.push(error.message));
  const previewTime = Date.now();
  const data = preview ? rows.slice(0, 4).map((item, index) => ({ ...item, name: ["主通信器", "备用接收机", "导航信标", "信号测试仪"][index], last_seen_ms: previewTime, last_rssi: [-48, -65, -78, -91][index] })) : rows;
  const samples = preview ? Object.fromEntries(data.map((item, deviceIndex) => [item.id, Array.from({ length: 60 }, (_, index) => ({ time_ms: previewTime - (59 - index) * 700, rssi: item.last_rssi + (index + deviceIndex) % 6 - 3 }))])) : history;
  const state = { ...status, fresh_count: data.length, device_count: data.length };
  await page.route("**/api/**", route => route.fulfill({ json: state }));
  await page.routeWebSocket("**/ws", channel => channel.send(JSON.stringify({ type: "snapshot", status: state, devices: data, history: samples })));
}
async function shot(page, name) {
  if (name.includes("native-zoom")) {
    // Capture the browser surface directly; Playwright's CSS clip can distort preference-zoom screenshots.
    const client = await page.context().newCDPSession(page);
    const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, name + ".png"), Buffer.from(result.data, "base64"));
    await client.detach();
  } else await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
  report.screenshots.push(name + ".png");
}
async function geometry(page) {
  return page.evaluate(() => ({ dpr: devicePixelRatio, innerWidth, outerWidth, innerHeight, outerHeight, cssZoom: getComputedStyle(document.documentElement).zoom, overflow: document.documentElement.scrollWidth > innerWidth }));
}
async function contrast(page) {
  return page.evaluate(() => {
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const over = (front, back) => { const a = front[3] ?? 1; return front.slice(0, 3).map((value, i) => value * a + back[i] * (1 - a)); };
    function pair(selector, pseudo = null) {
      const element = document.querySelector(selector), style = getComputedStyle(element, pseudo), ancestors = [];
      for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      const background = ancestors.reduce((base, node) => over(rgb(getComputedStyle(node).backgroundColor), base), [0, 0, 0]);
      const foreground = over(rgb(style.color), background);
      const luminance = channels => channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return { foreground, background, ratio: (values[0] + .05) / (values[1] + .05) };
    }
    return { deviceName: pair(".device-name"), placeholder: pair("#searchInput", "::placeholder"), enabledStopButton: pair("#stopButton"), timeReadout: pair("#knobValue"), detail: pair("#detailContent") };
  });
}
function luminance(channels) { return channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
async function axisOverlay(page) {
  await page.waitForTimeout(3300);
  await page.evaluate(() => { const time = Date.now(); Date.now = () => time; renderChart(); });
  const geometry = await page.evaluate(() => ({ area: { ...chart.chartArea }, width: chart.width, height: chart.height,
    color: chart.options.scales.y.ticks.color, background: getComputedStyle(document.querySelector(".scope-screen")).backgroundColor,
    lineOpacity: Number(getComputedStyle(document.querySelector(".scope-screen"), "::before").opacity), noiseOpacity: Number(getComputedStyle(document.querySelector(".scope-screen"), "::after").opacity) }));
  const texturedBuffer = await page.locator("#signalChart").screenshot();
  const override = await page.addStyleTag({ content: ".scope-screen::before, .scope-screen::after, .scope-screen .crt-scan-pass { display: none !important; }" });
  const bareBuffer = await page.locator("#signalChart").screenshot();
  await override.evaluate(node => node.remove());
  fs.writeFileSync(path.join(output, "axis-textured.png"), texturedBuffer);
  fs.writeFileSync(path.join(output, "axis-overlay-disabled.png"), bareBuffer);
  const actual = PNG.sync.read(texturedBuffer), bare = PNG.sync.read(bareBuffer);
  const color = geometry.color.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16));
  const background = geometry.background.match(/[\d.]+/g).slice(0, 3).map(Number);
  const over = (front, back, alpha) => front.map((value, i) => value * alpha + back[i] * (1 - alpha));
  const blackAlpha = .6 * geometry.lineOpacity;
  const modeledForeground = over([255, 255, 255], over([0, 0, 0], color, blackAlpha), geometry.noiseOpacity);
  const modeledBackground = over([255, 255, 255], over([0, 0, 0], background, blackAlpha), geometry.noiseOpacity);
  const modeledRatio = (luminance(modeledForeground) + .05) / (luminance(modeledBackground) + .05);
  const rgb = (png, x, y) => [...png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
  const ratio = (fg, bg) => (luminance(fg) + .05) / (luminance(bg) + .05);
  const scale = actual.width / geometry.width;
  const samples = [];
  for (let y = 1; y < actual.height - 1; y++) for (let x = 1; x < actual.width - 1; x++) {
    const cssX = x / scale, cssY = y / scale, area = geometry.area;
    const axis = cssX < area.left - 5 && cssY >= area.top && cssY <= area.bottom ? "y" : cssX >= area.left && cssX <= area.right && cssY > area.bottom + 4 ? "x" : null;
    if (!axis) continue;
    const original = rgb(bare, x, y);
    if (original.reduce((sum, value, i) => sum + Math.abs(value - color[i]), 0) > 12) continue;
    const neighbors = [];
    for (let dx = -8; dx <= 8; dx++) if (dx && x + dx >= 0 && x + dx < bare.width && Math.max(...rgb(bare, x + dx, y)) <= 30) neighbors.push(rgb(actual, x + dx, y));
    if (!neighbors.length) continue;
    const localBackground = neighbors.reduce((a, b) => luminance(a) > luminance(b) ? a : b);
    samples.push({ axis, x, y, ratio: ratio(rgb(actual, x, y), localBackground) });
  }
  const values = samples.map(item => item.ratio).sort((a, b) => a - b);
  return { geometry, modeledRatio, samples: samples.length, xSamples: samples.filter(item => item.axis === "x").length, ySamples: samples.filter(item => item.axis === "y").length,
    minimum: values[0] || 0, p05: values[Math.floor(values.length * .05)] || 0, median: values[Math.floor(values.length / 2)] || 0, lowest: samples.sort((a, b) => a.ratio - b.ratio).slice(0, 8) };
}
async function tickLayout(page) {
  return page.evaluate(() => {
    const scale = chart.scales.x, font = chart.options.scales.x.ticks.font, size = font?.size || Chart.defaults.font.size, family = font?.family || Chart.defaults.font.family;
    chart.ctx.save(); chart.ctx.font = `${size}px ${family}`;
    const labels = scale.ticks.map(tick => ({ text: String(tick.label), center: scale.getPixelForValue(tick.value), width: chart.ctx.measureText(String(tick.label)).width }));
    chart.ctx.restore();
    return { cap: chart.options.scales.x.ticks.maxTicksLimit, count: labels.length, labels, noCollision: labels.every((label, index) => index === 0 || label.center - label.width / 2 >= labels[index - 1].center + labels[index - 1].width / 2 + 4) };
  });
}
(async () => {
  for (const factor of [1, .5]) {
    const profile = path.join(profileRoot, "zoom-" + factor);
    fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
    // Chromium stores zoom as a per-partition dictionary; "x" is the default partition's empty relative path.
    fs.writeFileSync(path.join(profile, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(factor) / Math.log(1.2) } } }));
    context = await chromium.launchPersistentContext(profile, { headless: true, executablePath, viewport: null, args: ["--window-size=1440,1000", "--force-device-scale-factor=1"] });
    const page = context.pages()[0]; await mock(page);
    await page.goto(base); await page.waitForFunction(() => document.querySelector("#homeDeviceCount").textContent === "120");
    await page.waitForTimeout(1700);
    const home = await geometry(page);
    report.measurements["zoom" + factor] = { home };
    check(`${factor * 100}% zoom home has no CSS zoom or overflow`, home.cssZoom === "1" && !home.overflow);
    if (factor === 1) check("native zoom control starts at DPR 1", Math.abs(home.dpr - 1) < .01 && Math.abs(home.innerWidth - home.outerWidth) < 25);
    else check("native Chromium 50% zoom yields DPR .5 and double layout width", Math.abs(home.dpr - .5) < .01 && Math.abs(home.innerWidth - home.outerWidth * 2) < 50 && home.innerWidth >= 2800);
    await shot(page, "home-native-zoom" + factor * 100);
    await page.goto(base + "/monitor" + query);
    await page.waitForFunction(() => chart.data.datasets.length === 4 && document.querySelectorAll(".device-card").length > 0);
    const monitor = await geometry(page);
    report.measurements["zoom" + factor].monitor = monitor;
    check(`${factor * 100}% zoom live monitor has no CSS zoom or overflow`, monitor.cssZoom === "1" && !monitor.overflow);
    await shot(page, "monitor-native-zoom" + factor * 100);
    if (factor === 1) {
      report.measurements.finalContrast = await contrast(page);
      check("final-font rendered text and enabled controls exceed 4.5:1", Object.values(report.measurements.finalContrast).every(pair => pair.ratio >= 4.5));
      report.measurements.finalFont = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, name: getComputedStyle(document.querySelector(".device-name")).fontFamily, plexLoaded: document.fonts.check('16px "IBM Plex Mono"') }));
      check("Chinese fallback has Microsoft YaHei and sans-serif", report.measurements.finalFont.body.includes("Microsoft YaHei") && report.measurements.finalFont.body.includes("sans-serif") && report.measurements.finalFont.plexLoaded);
      report.measurements.axisOverlay = await axisOverlay(page);
      check("axis contrast bound includes static black scans and white noise", report.measurements.axisOverlay.modeledRatio >= 4.5);
      check("opaque axis strokes with real scanlines and edge vignette exceed 4.5:1", report.measurements.axisOverlay.samples >= 20 && report.measurements.axisOverlay.minimum >= 4.5);
      report.measurements.desktopTicks = await tickLayout(page);
      check("desktop tick cap stays six without timecode collisions", report.measurements.desktopTicks.cap === 6 && report.measurements.desktopTicks.count <= 6 && report.measurements.desktopTicks.noCollision);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(300);
      report.measurements.mobileTicks = await tickLayout(page);
      check("mobile tick cap is three without timecode collisions", report.measurements.mobileTicks.cap === 3 && report.measurements.mobileTicks.count <= 3 && report.measurements.mobileTicks.noCollision);
      report.measurements.finalMobile = await page.evaluate(() => ({ inputFont: parseFloat(getComputedStyle(document.querySelector("#searchInput")).fontSize), selectFont: parseFloat(getComputedStyle(document.querySelector("#sortSelect")).fontSize), overflow: document.documentElement.scrollWidth > innerWidth,
        targets: Object.fromEntries([".brand", "#stopButton", ".compare-control", "#windowKnob"].map(selector => [selector, document.querySelector(selector).getBoundingClientRect().height])) }));
      check("final-font mobile input size, targets and long names fit", report.measurements.finalMobile.inputFont >= 16 && report.measurements.finalMobile.selectFont >= 16 && !report.measurements.finalMobile.overflow && Object.values(report.measurements.finalMobile.targets).every(value => value >= 44));
      await shot(page, "monitor-final-fonts-375");
    }
    await context.close(); context = null;
  }
  const previewProfile = path.join(profileRoot, "clean-preview");
  context = await chromium.launchPersistentContext(previewProfile, { headless: true, executablePath, viewport: { width: 1440, height: 960 }, args: ["--force-device-scale-factor=1"] });
  const previewPage = context.pages()[0]; await mock(previewPage, true);
  await previewPage.goto(base + "/monitor" + query + "&focus=" + encodeURIComponent(rows[0].id));
  await previewPage.waitForFunction(() => chart.data.datasets.length === 4);
  await previewPage.waitForTimeout(3400);
  report.measurements.cleanPreviews = [];
  for (const width of [1440, 320]) {
    await previewPage.setViewportSize({ width, height: 960 }); await previewPage.waitForTimeout(200);
    await previewPage.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    const ticks = await tickLayout(previewPage);
    const state = await previewPage.evaluate(() => ({ windowSeconds, visibleCurves: chart.data.datasets.filter(dataset => !dataset.hidden).length, devices: devices.size, overflow: document.documentElement.scrollWidth > innerWidth, keyboardFocus: document.activeElement.matches(":focus-visible") }));
    report.measurements.cleanPreviews.push({ width, ticks, ...state });
    await shot(previewPage, "monitor-clean-" + width);
  }
  check("clean previews retain four visible curves, sole range knob and readable timecodes", report.measurements.cleanPreviews.every(item => item.windowSeconds === 60 && item.visibleCurves === 4 && item.devices === 4 && !item.overflow && !item.keyboardFocus && item.ticks.noCollision));
  await context.close(); context = null;
  check("native zoom checks have no browser script errors", report.errors.length === 0);
})().catch(error => { report.failure = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close();
  const resolved = path.resolve(profileRoot);
  if (resolved.startsWith(tempRoot + path.sep) && path.basename(resolved).startsWith("bluetooth-cassette-zoom-")) fs.rmSync(resolved, { recursive: true, force: true });
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log("checks", report.checks.length);
});
