"use strict";

const $ = (id) => document.getElementById(id);
const elements = {
  connection: $("connection"), start: $("startButton"), stop: $("stopButton"),
  radio: $("radioMetric"), scan: $("scanMetric"), fresh: $("freshCount"),
  total: $("deviceTotal"), notice: $("notice"), list: $("deviceList"),
  search: $("searchInput"), sort: $("sortSelect"), detail: $("detailContent"),
  detailIndex: $("detailIndex"), chartEmpty: $("chartEmpty"),
};

const palette = ["#3268e9", "#e68145", "#20a793", "#9b70d6"];
const devices = new Map();
const histories = new Map();
const selected = [];
let focused = null;
let currentStatus = { scan_state: "stopped", radio_state: "unknown", error: null };
let socket = null;
let reconnectTimer = null;
let renderTimer = null;
let lastRenderAt = 0;
let windowSeconds = 60;
let busy = false;
let autoSelected = false;
let transientNotice = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function shortAddress(value) {
  return value || "地址未知";
}

function ageText(timeMs) {
  const age = Math.max(0, Math.floor((Date.now() - timeMs) / 1000));
  if (age < 2) return "刚刚收到";
  if (age < 60) return `${age} 秒前`;
  return `${Math.floor(age / 60)} 分钟前`;
}

function freshness(device) {
  const age = Date.now() - device.last_seen_ms;
  if (age < 5000) return "fresh";
  if (age < 30000) return "stale";
  return "missing";
}

function strength(rssi) {
  if (rssi >= -60) return { key: "strong", text: "强", width: 100 };
  if (rssi >= -80) return { key: "medium", text: "中", width: Math.max(35, ((rssi + 100) / 40) * 100) };
  return { key: "weak", text: "弱", width: Math.max(8, ((rssi + 110) / 30) * 35) };
}

function broadcastCompany(device) {
  if (!device.company_ids?.length) return "未提供";
  return device.broadcast_companies.map((name, index) =>
    name === "未知厂商" ? `${name} (${device.company_ids[index]})` : name).join("、");
}

function setNotice(text, tone = "neutral") {
  elements.notice.textContent = text;
  elements.notice.dataset.tone = tone;
}

function showTransientNotice(text, tone = "error") {
  transientNotice = { text, tone, until: Date.now() + 4500 };
  scheduleRender();
}

function applyStatus(status) {
  currentStatus = status;
  scheduleRender();
}

function applySnapshot(message) {
  devices.clear();
  histories.clear();
  for (const device of message.devices || []) devices.set(device.id, device);
  for (const [id, samples] of Object.entries(message.history || {})) histories.set(id, samples);
  for (let index = selected.length - 1; index >= 0; index--) {
    if (!devices.has(selected[index])) selected.splice(index, 1);
  }
  if (focused && !devices.has(focused)) focused = null;
  selectFirstDevice();
  applyStatus(message.status);
}

function applyDelta(message) {
  for (const id of message.removed || []) {
    devices.delete(id);
    histories.delete(id);
    const index = selected.indexOf(id);
    if (index >= 0) selected.splice(index, 1);
    if (focused === id) focused = null;
  }
  for (const device of message.devices || []) devices.set(device.id, device);
  for (const [id, additions] of Object.entries(message.samples || {})) {
    const samples = histories.get(id) || [];
    samples.push(...additions);
    const cutoff = Date.now() - 300000;
    while (samples.length > 3000 || (samples.length && samples[0].time_ms < cutoff)) samples.shift();
    histories.set(id, samples);
  }
  selectFirstDevice();
  applyStatus(message.status);
}

function selectFirstDevice() {
  if (autoSelected || !devices.size) return;
  const newest = [...devices.values()].sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
  selected.push(newest.id);
  focused = newest.id;
  autoSelected = true;
}

function scheduleRender() {
  if (renderTimer) return;
  const delay = Math.max(0, 200 - (performance.now() - lastRenderAt));
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    lastRenderAt = performance.now();
    render();
  }, delay);
}

function renderStatus() {
  const radioLabels = { on: "已开启", off: "已关闭", missing: "未找到", disabled: "已禁用", unknown: "未知" };
  const scanLabels = { stopped: "待命", scanning: "扫描中", error: "需要处理" };
  elements.radio.textContent = radioLabels[currentStatus.radio_state] || "未知";
  elements.scan.textContent = scanLabels[currentStatus.scan_state] || "待命";
  const freshCount = [...devices.values()].filter((device) => freshness(device) === "fresh").length;
  elements.fresh.textContent = freshCount;
  elements.total.textContent = devices.size;
  elements.start.disabled = busy || currentStatus.scan_state === "scanning";
  elements.stop.disabled = busy || currentStatus.scan_state !== "scanning";
  if (transientNotice && Date.now() < transientNotice.until) {
    setNotice(transientNotice.text, transientNotice.tone);
  } else if (currentStatus.error) setNotice(currentStatus.error, "error");
  else if (currentStatus.scan_state === "scanning") {
    setNotice(freshCount ? "正在接收附近的 BLE 广播；选中设备可比较信号变化。" : "扫描中，当前未收到新的 BLE 广播。请确认附近设备正在广播。", freshCount ? "success" : "neutral");
  } else if (devices.size) setNotice("扫描已停止；历史曲线保留至关闭服务。", "neutral");
  else setNotice("点击“开始扫描”接收周围 BLE 广播。", "neutral");
}

function deviceCard(device) {
  const id = escapeHtml(device.id);
  const name = escapeHtml(device.name || "未命名设备");
  const company = escapeHtml(broadcastCompany(device));
  const brand = device.possible_brand ? `<span class="brand-hint">可能 ${escapeHtml(device.possible_brand)}</span>` : "";
  const stale = freshness(device);
  const latest = device.last_rssi == null ? "—" : `${device.last_rssi} <small>dBm</small>`;
  const signal = strength(device.last_rssi ?? -110);
  const checked = selected.includes(device.id) ? "checked" : "";
  const focusedClass = focused === device.id ? " focused" : "";
  return `<article class="device-card ${stale}${focusedClass}">
    <button type="button" class="device-open" data-id="${id}" aria-label="查看 ${name} 的详情">
      <div class="device-top"><span class="device-name">${name}</span>${brand}<span class="signal-value">${latest}</span></div>
      <div class="device-meta"><span class="mono">${escapeHtml(shortAddress(device.address))}</span><span class="meta-dot">·</span><span>${escapeHtml(ageText(device.last_seen_ms))}</span></div>
      <div class="device-bottom"><div class="signal-track"><span class="${signal.key}" style="width:${signal.width}%"></span></div><span class="strength-label ${signal.key}">${signal.text}</span></div>
      <div class="device-company">广播厂商：${company}</div>
      ${stale !== "fresh" ? `<div class="stale-tag">${stale === "stale" ? "暂无新信号" : "未再检测到"} · 上次测量</div>` : ""}
    </button>
    <label class="compare-control" title="加入或移出信号对比"><input type="checkbox" data-id="${id}" ${checked}><span>对比</span></label>
  </article>`;
}

function renderDevices() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const rows = [...devices.values()].filter((device) => {
    if (!query) return true;
    return [device.name, device.address, device.possible_brand, ...(device.broadcast_companies || [])]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query));
  });
  const sortMode = elements.sort.value;
  rows.sort((a, b) => {
    if (sortMode === "name") return (a.name || "").localeCompare(b.name || "", "zh-CN");
    if (sortMode === "recent") return b.last_seen_ms - a.last_seen_ms;
    return (b.last_rssi ?? -999) - (a.last_rssi ?? -999);
  });
  if (!rows.length) {
    elements.list.innerHTML = query
      ? '<div class="empty-list small"><strong>没有匹配的设备</strong><p>换个名称、地址或厂商试试。</p></div>'
      : '<div class="empty-list"><div class="empty-rings" aria-hidden="true"><span></span></div><strong>等待蓝牙信号</strong><p>开始扫描后，收到的设备会出现在这里。</p></div>';
    return;
  }
  elements.list.innerHTML = rows.map(deviceCard).join("");
}

function detailField(label, value, isMono = false) {
  return `<div class="detail-field"><dt>${escapeHtml(label)}</dt><dd${isMono ? ' class="mono"' : ""}>${escapeHtml(value)}</dd></div>`;
}

function renderDetails() {
  const device = focused ? devices.get(focused) : null;
  if (!device) {
    elements.detail.textContent = "选择左侧设备查看广播信息与识别依据。";
    elements.detail.className = "detail-empty";
    elements.detailIndex.textContent = "—";
    return;
  }
  elements.detail.className = "detail-content";
  elements.detailIndex.textContent = "BLE 广播";
  const ids = device.company_ids?.length ? device.company_ids.join("、") : "未提供";
  const services = device.service_uuids?.length ? device.service_uuids.join("、") : "未提供";
  elements.detail.innerHTML = `<div class="detail-intro"><strong>${escapeHtml(device.name || "未命名设备")}</strong><span class="detail-state ${freshness(device)}">${freshness(device) === "fresh" ? "最近收到" : freshness(device) === "stale" ? "暂无新信号" : "未再检测到"}</span></div>
    <dl class="detail-grid">
      ${detailField("设备地址", device.address, true)}
      ${detailField("广播名称", device.advertised_name || "未提供")}
      ${detailField("Windows 已配对设备名", device.paired_name || "未提供")}
      ${detailField("系统名称", device.system_name || "未提供")}
      ${detailField("广播厂商", broadcastCompany(device))}
      ${detailField("厂商编号", ids, true)}
      ${detailField("可能品牌", device.possible_brand ? `${device.possible_brand}（${device.brand_source}）` : "未知")}
      ${detailField("服务 UUID", services, true)}
      ${detailField("最后接收", ageText(device.last_seen_ms))}
    </dl>`;
}

const chart = new Chart($("signalChart"), {
  type: "line",
  data: { datasets: [] },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: "nearest", intersect: false },
    elements: { point: { radius: 0, hitRadius: 8, hoverRadius: 4 }, line: { borderWidth: 2, tension: 0.13 } },
    plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 18, color: "#526078", font: { size: 11 } } }, tooltip: {
      callbacks: { title: (items) => items.length ? new Date(items[0].parsed.x).toLocaleTimeString("zh-CN", { hour12: false }) : "", label: (item) => `${item.dataset.label}: ${item.parsed.y} dBm` },
    } },
    scales: {
      x: { type: "linear", grid: { color: "#edf0f5" }, border: { display: false }, ticks: { color: "#8994a8", maxTicksLimit: 6, callback: (value) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) } },
      y: { suggestedMin: -100, suggestedMax: -20, grid: { color: "#edf0f5" }, border: { display: false }, ticks: { color: "#8994a8", callback: (value) => `${value} dBm` } },
    },
  },
});

function chartPoints(samples, cutoff, now) {
  const visible = samples.filter((item) => item.time_ms >= cutoff && item.time_ms <= now);
  const points = [];
  let previous = null;
  for (const item of visible) {
    if (previous !== null && item.time_ms - previous > 5000) points.push({ x: previous + 5001, y: null });
    points.push({ x: item.time_ms, y: item.rssi });
    previous = item.time_ms;
  }
  if (previous !== null && now - previous >= 5000) points.push({ x: previous + 5001, y: null });
  return points;
}

function renderChart() {
  const now = currentStatus.scan_state === "scanning" ? Date.now() : (currentStatus.stopped_at_ms || Date.now());
  const cutoff = now - windowSeconds * 1000;
  chart.options.scales.x.min = cutoff;
  chart.options.scales.x.max = now;
  chart.data.datasets = selected.map((id, index) => {
    const device = devices.get(id);
    return {
      label: device?.name || id,
      data: chartPoints(histories.get(id) || [], cutoff, now),
      borderColor: palette[index], backgroundColor: palette[index], pointBackgroundColor: palette[index],
      spanGaps: false,
    };
  });
  elements.chartEmpty.hidden = selected.length > 0;
  chart.update("none");
}

function render() {
  renderStatus();
  renderDevices();
  renderDetails();
  renderChart();
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener("open", () => {
    elements.connection.classList.add("online");
    elements.connection.querySelector("span:last-child").textContent = "本机已连接";
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") applySnapshot(message);
    if (message.type === "delta") applyDelta(message);
  });
  socket.addEventListener("close", () => {
    elements.connection.classList.remove("online");
    elements.connection.querySelector("span:last-child").textContent = "正在重连";
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });
}

async function scanCommand(action) {
  busy = true;
  scheduleRender();
  try {
    const response = await fetch(`/api/scan/${action}`, { method: "POST" });
    const status = await response.json();
    applyStatus(status);
  } catch (error) {
    showTransientNotice(`无法连接本地服务：${error.message}`);
  } finally {
    busy = false;
    scheduleRender();
  }
}

elements.start.addEventListener("click", () => scanCommand("start"));
elements.stop.addEventListener("click", () => scanCommand("stop"));
elements.search.addEventListener("input", scheduleRender);
elements.sort.addEventListener("change", scheduleRender);
elements.list.addEventListener("click", (event) => {
  const button = event.target.closest(".device-open");
  if (!button) return;
  const id = button.dataset.id;
  focused = id;
  if (!selected.includes(id)) {
    if (selected.length < 4) selected.push(id);
    else showTransientNotice("最多同时对比 4 台设备。");
  }
  scheduleRender();
});
elements.list.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".compare-control input");
  if (!checkbox) return;
  const id = checkbox.dataset.id;
  const index = selected.indexOf(id);
  if (index >= 0) selected.splice(index, 1);
  else if (selected.length < 4) { selected.push(id); focused = id; }
  else { checkbox.checked = false; showTransientNotice("最多同时对比 4 台设备。"); }
  scheduleRender();
});
document.querySelectorAll("[data-window]").forEach((button) => button.addEventListener("click", () => {
  windowSeconds = Number(button.dataset.window);
  document.querySelectorAll("[data-window]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  scheduleRender();
}));

fetch("/api/status").then((response) => response.json()).then(applyStatus).catch(() => {});
connect();
setInterval(scheduleRender, 1000);
