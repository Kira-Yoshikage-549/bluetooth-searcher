/* Plan acceptance checks. HTTP mutations and WebSocket traffic are mocked. */
"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const base = process.env.BLUETOOTH_TEST_URL || "http://127.0.0.1:8765";
const output = path.resolve(__dirname, process.env.BLUETOOTH_QA_ROOT || "cassette-refinement", "plan");
const localChrome = "C:/Users/PC/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const executablePath = process.env.BLUETOOTH_CHROME_PATH || (fs.existsSync(localChrome) ? localChrome : undefined);
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], errors: [], screenshots: [], measurements: {} };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(name, value) { assert.ok(value, name); report.checks.push(name); console.log("PASS", name); }
function device(index, now) {
  const id = `CA:00:00:00:${Math.floor(index / 256).toString(16).padStart(2, "0")}:${(index % 256).toString(16).padStart(2, "0")}`.toUpperCase();
  return { id, address: id, name: index === 0 ? "测试耳机" : `设备 ${index}`,
    last_seen_ms: now, last_rssi: -45 - index % 50, advertised_name: null, paired_name: null,
    system_name: null, possible_brand: null, brand_source: null, company_ids: [],
    broadcast_companies: [], service_uuids: [] };
}
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  const status = { scan_state: "scanning", radio_state: "on", error: null, stopped_at_ms: null };
  let rows = [], history = {}, channels = [];
  const snapshot = () => ({ type: "snapshot", status: { ...status }, devices: rows, history });
  const send = (value) => channels.at(-1).send(JSON.stringify(value));
  async function open(query = "") {
    await page.goto(base + "/monitor" + query);
    await page.waitForFunction(() => document.querySelector("#connection").classList.contains("online"));
    await page.waitForTimeout(300);
  }
  async function setCount(count) {
    const now = Date.now();
    rows = Array.from({ length: count }, (_, index) => device(index, now));
    history = Object.fromEntries(rows.map((item) => [item.id, [{ time_ms: now, rssi: item.last_rssi }]]));
    send(snapshot());
    await page.waitForFunction((expected) => document.querySelector("#deviceTotal").textContent === new Intl.NumberFormat("zh-CN").format(expected), count);
    await page.waitForTimeout(250);
  }
  async function shot(name) {
    await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
    report.screenshots.push(name + ".png");
  }
  await page.route("**/api/**", (route) => route.fulfill({ json: status }));
  await page.routeWebSocket("**/ws", (channel) => { channels.push(channel); channel.send(JSON.stringify(snapshot())); });

  await open();
  for (const count of [0, 1, 50, 120, 1000]) {
    await setCount(count);
    const mounted = await page.locator(".device-card").count();
    check(`${count} devices: bounded mounted cards`, mounted <= 25);
    if (count === 0) check("scanning empty list explains the wait for BLE broadcasts", (await page.locator("#emptyTitle").innerText()).includes("等待附近设备") && await page.locator("#stopButton").isEnabled());
    if (count === 1) check("single device is reachable", mounted === 1 && await page.locator(".device-card .device-open").isVisible());
    if (count === 50) {
      await page.evaluate(() => focusCardControl(visibleIds[0], "button"));
      for (let step = 0; step < 100; step++) await page.keyboard.press("Tab");
      check("all 50 cards follow keyboard Tab order", await page.evaluate(() => document.activeElement.matches("#windowKnob")));
      await page.evaluate(() => {
        focusCardControl(visibleIds[5], "button");
        elements.search.value = "不存在的设备";
        elements.search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelectorAll(".device-card").length === 0);
      check("filtering a focused card moves focus to search", await page.evaluate(() => document.activeElement === elements.search));
      await page.evaluate(() => { elements.search.value = ""; elements.search.dispatchEvent(new Event("input", { bubbles: true })); });
    }
    if (count === 1000) {
      await page.locator("#deviceList").evaluate((list) => { list.scrollTop = list.scrollHeight; });
      await page.waitForTimeout(300);
      check("1000th device mounts near list end", await page.locator(`.device-card[data-device-id="${rows.at(-1).id}"]`).count() === 1);
      check("end of 1000-device list is still windowed", await page.locator(".device-card").count() <= 25);
      await page.evaluate(() => focusCardControl(visibleIds.at(-2), "checkbox"));
      await page.keyboard.press("Tab");
      check("Tab crosses the final virtual window boundary", await page.evaluate(() => document.activeElement.closest(".device-card")?.dataset.deviceId === visibleIds.at(-1)));
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      check("Tab leaves the virtual list", await page.evaluate(() => document.activeElement.matches("#windowKnob")));
      await page.keyboard.press("Shift+Tab");
      check("Shift Tab from knob restores final virtual checkbox", await page.evaluate(() => document.activeElement.matches(".compare-control input") && document.activeElement.closest(".device-card")?.dataset.deviceId === visibleIds.at(-1)));
    }
  }

  await setCount(120);
  await open("?compare=&sort=name&window=300&data=1");
  check("explicit empty compare survives refresh", await page.evaluate(() => selected.length === 0 && document.querySelector("#dataPanel").open));
  check("URL restores ordinary controls", await page.evaluate(() => document.querySelector("#sortSelect").value === "name" && document.querySelector("#windowKnob").dataset.windowSeconds === "300"));
  check("empty data panel gives a next step", (await page.locator("#dataEmpty").innerText()).includes("选择设备"));
  await shot("data-empty-1440");

  await open("?compare=missing&focus=missing&hidden=missing&sort=bad&window=bad&page=-1");
  check("invalid device references are cleared without substitute", await page.evaluate(() => selected.length === 0 && focused === null && !location.search.includes("missing")));
  check("invalid controls fall back to defaults", await page.evaluate(() => document.querySelector("#sortSelect").value === "strength" && document.querySelector("#windowKnob").dataset.windowSeconds === "60"));
  check("stale link reports recovery", await page.locator("#notice").isVisible());

  const now = Date.now();
  rows = [device(0, now), device(1, now)];
  history = { [rows[0].id]: Array.from({ length: 120 }, (_, i) => ({ time_ms: now - (119 - i) * 450, rssi: -80 + i % 20 })), [rows[1].id]: [] };
  await open(`?compare=${encodeURIComponent(rows[0].id)}&data=1&page=9`);
  await page.waitForFunction(() => document.querySelectorAll("#dataRows tr").length === 20);
  check("out-of-range page clamps to final page", await page.evaluate(() => dataPage === 3 && new URLSearchParams(location.search).get("page") === "3"));
  check("snapshot table contains only real samples", await page.evaluate(() => dataSnapshot.rows.length === 120 && document.querySelectorAll("#dataRows tr").length === 20));
  check("summary matches raw history", await page.evaluate(() => dataSnapshot.stats[0].count === 120 && dataSnapshot.stats[0].latest === histories.get(selected[0]).at(-1).rssi));
  await page.locator("#previousPage").click();
  check("previous page renders at most 50 rows", await page.locator("#dataRows tr").count() === 50);
  await page.locator("#nextPage").click();
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => dataPage === 2);
  check("Back restores data page", await page.evaluate(() => dataPage === 2 && document.querySelectorAll("#dataRows tr").length === 50));
  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => dataPage === 3);
  check("Forward restores data page", await page.evaluate(() => dataPage === 3));
  await shot("data-page-1440");

  const frozen = await page.evaluate(() => ({ count: dataSnapshot.rows.length, first: document.querySelector("#dataRows tr")?.textContent }));
  const sample = { time_ms: Date.now(), rssi: -33 };
  rows[0].last_seen_ms = sample.time_ms; rows[0].last_rssi = sample.rssi;
  send({ type: "delta", status, devices: [rows[0]], removed: [], samples: { [rows[0].id]: [sample] } });
  await pause(350);
  check("incoming samples do not rearrange open table", await page.evaluate((before) => dataSnapshot.rows.length === before.count && document.querySelector("#dataRows tr")?.textContent === before.first, frozen));
  await page.locator("#refreshData").click();
  check("refresh rebuilds frozen data and returns to page one", await page.evaluate(() => dataSnapshot.rows.length === 121 && dataPage === 1 && document.querySelectorAll("#dataRows tr").length === 50));

  await page.locator("#chartLegend button").first().focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("#chartLegend button")?.getAttribute("aria-pressed") === "false");
  check("keyboard-operable HTML legend writes hidden URL state", await page.evaluate(() => document.querySelector("#chartLegend button").getAttribute("aria-pressed") === "false" && new URLSearchParams(location.search).get("hidden") === selected[0]));
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.querySelector("#chartLegend button").getAttribute("aria-pressed") === "true");
  check("Back restores curve visibility", await page.evaluate(() => !hiddenLines.has(selected[0])));
  await page.locator("#windowKnob").click();
  check("changing window rebuilds snapshot at page one", await page.evaluate(() => dataPage === 1 && document.querySelector("#windowKnob").dataset.windowSeconds === "300"));

  await page.locator("#searchInput").fill("测试耳机");
  await pause(320);
  check("search replaces URL after debounce", new URLSearchParams(new URL(page.url()).search).get("q") === "测试耳机");
  await page.locator("#searchInput").fill("");
  await pause(320);
  await page.locator("#sortSelect").selectOption("name");
  check("sorting pushes URL state", new URLSearchParams(new URL(page.url()).search).get("sort") === "name");

  await page.setViewportSize({ width: 375, height: 812 });
  await shot("data-mobile-375");
  await setCount(120);
  await open();
  await page.evaluate(() => {
    elements.list.scrollTop = 850;
    window.scrollTo({ top: 180, behavior: "instant" });
  });
  await pause(300);
  const firstScroll = await page.evaluate(() => ({ list: elements.list.scrollTop, page: window.scrollY }));
  await page.evaluate(() => document.querySelector("#windowKnob").click());
  await page.evaluate(() => { elements.list.scrollTop = 1320; window.scrollTo({ top: 300, behavior: "instant" }); });
  await pause(300);
  await page.evaluate(() => document.querySelector("#windowKnob").click());
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => windowSeconds === 300);
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => windowSeconds === 60);
  await pause(350);
  const restored = await page.evaluate(() => ({ list: elements.list.scrollTop, page: window.scrollY }));
  report.measurements.scroll = { firstScroll, restored };
  check("Back restores page and device-list anchor", Math.abs(restored.list - firstScroll.list) < 70 && Math.abs(restored.page - firstScroll.page) < 40);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#deviceTotal").textContent === "120");
  await pause(350);
  const refreshed = await page.evaluate(() => ({ list: elements.list.scrollTop, page: window.scrollY }));
  report.measurements.scroll.refreshed = refreshed;
  check("refresh restores page and device-list anchor", Math.abs(refreshed.list - firstScroll.list) < 70 && Math.abs(refreshed.page - firstScroll.page) < 40);

  const removed = await page.evaluate(() => {
    const id = visibleIds[5], next = visibleIds[6];
    focusCardControl(id, "button");
    cardNodes.get(id).button.click();
    return { id, next };
  });
  rows = rows.filter((item) => item.id !== removed.id);
  delete history[removed.id];
  send({ type: "delta", status, devices: [], samples: {}, removed: [removed.id] });
  await page.waitForFunction((next) => focused === next && document.activeElement.closest(".device-card")?.dataset.deviceId === next, removed.next);
  check("removed focused device moves focus to next device", await page.evaluate((next) => focused === next, removed.next));

  await page.evaluate(() => {
    selected.splice(0, selected.length, ...visibleIds.slice(0, 4));
    assignLineSlots();
    scheduleRender();
    window.__renderTimes = [];
    window.__longTasks = 0;
    const original = window.render;
    window.render = function () { const start = performance.now(); original(); window.__renderTimes.push(performance.now() - start); };
    new PerformanceObserver((list) => { window.__longTasks += list.getEntries().length; }).observe({ entryTypes: ["longtask"] });
  });
  const client = await context.newCDPSession(page);
  for (const rate of [1, 4]) {
    await client.send("Emulation.setCPUThrottlingRate", { rate });
    await page.evaluate(() => { window.__renderTimes.length = 0; window.__longTasks = 0; });
    for (let i = 0; i < 25; i++) {
      const time = Date.now();
      rows.forEach((item, index) => { item.last_seen_ms = time; item.last_rssi = -45 - index % 50 + i % 3; });
      const samples = Object.fromEntries(rows.slice(0, 4).map((item) => [item.id, [{ time_ms: time, rssi: item.last_rssi }]]));
      send({ type: "delta", status, devices: rows, samples, removed: [] });
      await pause(200);
    }
    await pause(500);
    const values = await page.evaluate(() => ({ renders: window.__renderTimes.slice(), longTasks: window.__longTasks, cards: document.querySelectorAll(".device-card").length, datasets: chart.data.datasets.length }));
    const sorted = values.renders.slice().sort((a, b) => a - b);
    report.measurements[`cpu${rate}x`] = { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)] || 0, p95Ms: sorted[Math.floor(sorted.length * .95)] || 0, longTasks: values.longTasks, cards: values.cards, datasets: values.datasets };
    check(`${rate}x CPU: four curves and bounded card DOM`, values.datasets === 4 && values.cards <= 25 && sorted.length >= 10);
  }
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  check("remaining curves keep their style when one is removed", await page.evaluate(() => {
    const before = new Map(lineSlots);
    selected.splice(1, 1);
    assignLineSlots();
    scheduleRender();
    return selected.every((id) => lineSlots.get(id) === before.get(id));
  }));

  await shot("monitor-mobile-375");
  const targets = await page.evaluate(() => {
    const height = (selector) => document.querySelector(selector).getBoundingClientRect().height;
    return { inputFont: parseFloat(getComputedStyle(document.querySelector("#searchInput")).fontSize),
      selectFont: parseFloat(getComputedStyle(document.querySelector("#sortSelect")).fontSize),
      brand: height(".brand"), scan: height("#startButton"), compare: height(".compare-control"), window: height("#windowKnob"), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  report.measurements.mobileTargets = targets;
  check("mobile inputs avoid zoom and touch targets reach 44px", targets.inputFont >= 16 && targets.selectFont >= 16 && Math.min(targets.brand, targets.scan, targets.compare, targets.window) >= 44 && !targets.overflow);
  report.measurements.contrast = await page.evaluate(() => {
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const over = (front, back) => { const a = front[3] ?? 1; return front.slice(0, 3).map((value, i) => value * a + back[i] * (1 - a)); };
    function pair(selector, pseudo = null) {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element, pseudo);
      const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
      const background = ancestors.reduce((base, node) => over(rgb(getComputedStyle(node).backgroundColor), base), [0, 0, 0]);
      const foreground = over(rgb(style.color), background);
      const luminance = channels => channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return { foreground, background, ratio: (values[0] + .05) / (values[1] + .05) };
    }
    return { body: pair(".device-name"), search: pair("#searchInput"), searchPlaceholder: pair("#searchInput", "::placeholder"), enabledScanControl: pair("#stopButton"), timeReadout: pair("#knobValue") };
  });
  check("rendered ordinary text and primary controls meet 4.5:1 contrast", Object.values(report.measurements.contrast).every((value) => value.ratio >= 4.5));
  await page.setViewportSize({ width: 320, height: 812 });
  rows[0].name = "这是一个非常非常长的蓝牙设备名称，用于检查折叠数据表格和窄屏卡片的溢出行为";
  send({ type: "delta", status, devices: [rows[0]], samples: {}, removed: [] });
  await page.locator("#dataPanel summary").click();
  await pause(250);
  check("320px data panel and long names have no page overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector("#dataPanel").open));
  await shot("data-mobile-320");
  await page.locator("#dataPanel summary").click();
  await page.setViewportSize({ width: 2880, height: 1000 });
  await shot("monitor-2880");
  check("2880px viewport has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ reducedMotion: "reduce" });
  check("reduced motion can be enabled live", await page.evaluate(() => [...document.querySelectorAll(".crt-screen, .crt-screen *")].every(node => getComputedStyle(node).animationName === "none")));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check("normal motion can be restored live", await page.evaluate(() => !matchMedia("(prefers-reduced-motion: reduce)").matches));
  check("no browser script errors", report.errors.length === 0);
  await context.close();
})().catch((error) => { report.failure = error.stack; process.exitCode = 1; console.error(error); })
  .finally(async () => {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
    console.log("checks", report.checks.length);
  });
