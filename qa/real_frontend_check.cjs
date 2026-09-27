// Optional real-hardware UI check: starts only an idle, enabled adapter and always stops its own scan.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = process.env.BLUETOOTH_TEST_URL || "http://127.0.0.1:8765";
const output = path.join(__dirname, "two-page");
fs.mkdirSync(output, { recursive: true });
const result = { errors: [] };
let browser, context, ownScan = false;
(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  result.initial = await (await context.request.get(base + "/api/status")).json();
  if (result.initial.radio_state !== "on" || result.initial.scan_state === "scanning") {
    result.skipped = "Adapter unavailable or another scan already running; no hardware changes.";
    return;
  }
  const page = await context.newPage();
  page.on("pageerror", error => result.errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector("#startButton").disabled);
  ownScan = true;
  await page.locator("#startButton").click();
  await page.waitForURL(base + "/monitor");
  await page.waitForFunction(() => document.querySelector("#scanMetric").textContent === "扫描中");
  await page.waitForTimeout(15000);
  result.live = await page.evaluate(() => ({
    devices: devices.size, sampleCount: [...histories.values()].reduce((sum, values) => sum + values.length, 0),
    visibleCards: document.querySelectorAll(".device-card").length, status: currentStatus,
  }));
  console.log("LIVE", JSON.stringify(result.live));
  const boxes = page.locator(".compare-control input");
  for (let i = 0; i < Math.min(4, await boxes.count()); i++) {
    if (!await boxes.nth(i).isChecked()) {
      if (await page.locator(".compare-control input:checked").count() < 4) await boxes.nth(i).check();
    }
  }
  await page.locator('[data-window="300"]').click();
  await page.waitForTimeout(750);
  result.compared = await page.locator(".compare-control input:checked").count();
  await page.screenshot({ path: path.join(output, "real-scanning-1440.png") });
  await page.locator("#stopButton").click();
  await page.waitForFunction(() => document.querySelector("#scanMetric").textContent === "待命");
  // Status feedback is immediate; chart rendering and in-flight WS batches settle on the next 200 ms tick.
  await page.waitForFunction(() => chart.options.scales.x.max === currentStatus.stopped_at_ms);
  await page.waitForTimeout(500);
  const stopped = await page.evaluate(() => ({ end: chart.options.scales.x.max, count: [...histories.values()].reduce((sum, values) => sum + values.length, 0) }));
  result.stoppedBaseline = stopped;
  await page.waitForTimeout(6200);
  result.historyPreserved = await page.evaluate(previous => chart.options.scales.x.max === previous.end && [...histories.values()].reduce((sum, values) => sum + values.length, 0) === previous.count, stopped);
  result.afterWait = await page.evaluate(() => ({ end: chart.options.scales.x.max, count: [...histories.values()].reduce((sum, values) => sum + values.length, 0) }));
  assert.ok(result.historyPreserved, "Real stopped history and chart time must remain stable");
  result.final = await (await context.request.get(base + "/api/status")).json();
  assert.equal(result.final.scan_state, "stopped");
  await page.setViewportSize({ width: 375, height: 950 });
  await page.locator(".chart-panel").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(output, "real-chart-375.png") });
  assert.equal(result.errors.length, 0);
})().catch(error => { result.failure = error.stack; console.error(error); process.exitCode = 1; })
.finally(async () => {
  if (ownScan && context) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const status = await (await context.request.get(base + "/api/status")).json();
      if (status.scan_state === "scanning") {
        await context.request.post(base + "/api/scan/stop");
        break;
      }
      if (status.scan_state === "error") break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  if (browser) await browser.close();
  fs.writeFileSync(path.join(output, "hardware-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});

