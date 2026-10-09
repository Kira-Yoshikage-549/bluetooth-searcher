// Optional real-hardware UI check: starts only an idle, enabled adapter and always stops its own scan.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = process.env.BLUETOOTH_TEST_URL || "http://127.0.0.1:8765";
const output = path.resolve(__dirname, process.env.BLUETOOTH_QA_ROOT || "cassette-refinement", "hardware");
const executablePath = process.env.BLUETOOTH_CHROME_PATH;
fs.mkdirSync(output, { recursive: true });
const result = { errors: [] };
let browser, context, ownScan = false;
(async () => {
  assert.ok(executablePath, "Set BLUETOOTH_CHROME_PATH to the bundled Chromium executable");
  browser = await chromium.launch({ executablePath, headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  result.initial = await (await context.request.get(base + "/api/status")).json();
  if (result.initial.radio_state !== "on" || result.initial.scan_state !== "stopped") {
    result.skipped = "Adapter unavailable or another scan already running; no hardware changes.";
    return;
  }
  const page = await context.newPage();
  page.on("pageerror", error => result.errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector("#startButton").disabled);
  result.beforeStart = await (await context.request.get(base + "/api/status")).json();
  if (result.beforeStart.radio_state !== "on" || result.beforeStart.scan_state !== "stopped") {
    result.skipped = "Adapter no longer idle and enabled before start; no hardware changes.";
    return;
  }
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
      if (await page.evaluate(() => selected.length) < 4) await boxes.nth(i).check();
    }
  }
  await page.locator("#windowKnob").click();
  await page.waitForTimeout(750);
  result.compared = await page.evaluate(() => selected.length);
  result.comparison = await page.evaluate(() => ({ ids: [...selected], datasets: chart.data.datasets.length, expected: Math.min(4, devices.size) }));
  assert.equal(result.compared, result.comparison.expected, "Compare selection must use application state rather than mounted checkboxes");
  assert.equal(result.comparison.datasets, result.compared);
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

