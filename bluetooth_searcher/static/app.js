"use strict";

const $ = (id) => document.getElementById(id);
const elements = {
  connection: $("connection"),
  radio: $("radioMetric"), scan: $("scanMetric"), fresh: $("freshCount"),
  total: $("deviceTotal"), notice: $("notice"), list: $("deviceList"),
  search: $("searchInput"), sort: $("sortSelect"), detail: $("detailContent"),
  chartEmpty: $("chartEmpty"),
};

const palette = ["#0071e3", "#c08047", "#328b79", "#9972c3"];
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
let connected = false;
let statusReceived = false;
const cardNodes = new Map();
let listOrder = [];
let lastSortAt = -Infinity;
let forceListSort = true;
let listHovered = false;
let renderedDetailId;
let detailFields = [];
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

function setText(node, value) {
  const text = String(value ?? "");
  if (node.textContent !== text) node.textContent = text;
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
  setText(elements.notice, text);
  elements.notice.dataset.tone = tone;
  elements.notice.hidden = tone !== "error";
}

function showTransientNotice(text, tone = "error") {
  transientNotice = { text, tone, until: Date.now() + 4500 };
  scheduleRender();
}

function applyStatus(status) {
  statusReceived = true;
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
  const scanning = currentStatus.scan_state === "scanning";
  const freshCount = [...devices.values()].filter((device) => freshness(device) === "fresh").length;
  setText(elements.radio, radioLabels[currentStatus.radio_state] || "未知");
  setText(elements.scan, busy ? (busy === "start" ? "正在启动" : "正在停止") : connected ? scanLabels[currentStatus.scan_state] || "待命" : "连接中");
  setText(elements.fresh, freshCount);
  setText(elements.total, devices.size);
  document.querySelectorAll("[data-scan-action]").forEach((button) => {
    const start = button.dataset.scanAction === "start";
    button.disabled = !!busy || !connected || !statusReceived || (start ? scanning : !scanning);
    button.setAttribute("aria-busy", String(busy === button.dataset.scanAction));
    setText(button, busy === button.dataset.scanAction ? (start ? "正在启动…" : "正在停止…") : start ? "开始扫描" : "停止扫描");
  });
  if (transientNotice && Date.now() < transientNotice.until) setNotice(transientNotice.text, transientNotice.tone);
  else if (currentStatus.error) setNotice(currentStatus.error, "error");
  else setNotice("");
}

function createDeviceCard(device, animate) {
  const node = document.createElement("article");
  node.className = "device-card";
  node.dataset.deviceId = device.id;
  node.innerHTML = `<button type="button" class="device-open">
    <div class="device-top"><span class="device-name"></span><span class="signal-value"><span class="rssi-number"></span><small>dBm</small></span></div>
    <div class="device-meta"><span class="mono"></span><span class="meta-dot">·</span><span class="device-age"></span></div>
    <div class="device-bottom"><div class="signal-track"><span></span></div><span class="strength-label"></span></div>
    <div class="device-company"><span class="company-value"></span><span class="brand-hint"></span></div>
    <div class="stale-tag" hidden></div>
  </button>
  <label class="compare-control" title="加入或移出信号对比"><input type="checkbox"><span>对比</span></label>`;
  const card = { node };
  for (const [key, selector] of Object.entries({
    button: ".device-open", name: ".device-name", rssi: ".rssi-number", address: ".mono",
    age: ".device-age", fill: ".signal-track span", strength: ".strength-label",
    company: ".company-value", brand: ".brand-hint", stale: ".stale-tag", checkbox: "input",
  })) card[key] = node.querySelector(selector);
  card.button.dataset.id = device.id;
  card.checkbox.dataset.id = device.id;
  if (animate && !motionPreference.matches) {
    node.classList.add("new-device");
    node.addEventListener("animationend", () => node.classList.remove("new-device"), { once: true });
  }
  return card;
}

function updateDeviceCard(card, device) {
  const name = device.name || "未命名设备";
  const state = freshness(device);
  const signal = strength(device.last_rssi ?? -110);
  for (const key of ["fresh", "stale", "missing"]) card.node.classList.toggle(key, state === key);
  card.node.classList.toggle("focused", focused === device.id);
  card.button.setAttribute("aria-label", `查看 ${name} 的详情`);
  card.button.setAttribute("aria-pressed", String(focused === device.id));
  card.checkbox.setAttribute("aria-label", `对比 ${name}`);
  card.checkbox.checked = selected.includes(device.id);
  setText(card.name, name);
  card.name.title = name;
  setText(card.rssi, device.last_rssi ?? "—");
  setText(card.address, device.address || "地址未知");
  setText(card.age, ageText(device.last_seen_ms));
  card.fill.className = signal.key;
  card.fill.style.transform = `scaleX(${signal.width / 100})`;
  setText(card.strength, signal.text);
  setText(card.company, `广播厂商：${broadcastCompany(device)}`);
  card.company.title = broadcastCompany(device);
  setText(card.brand, device.possible_brand ? `可能 ${device.possible_brand}` : "");
  card.stale.hidden = state === "fresh";
  setText(card.stale, state === "stale" ? "暂无新信号 · 上次测量" : "未再检测到 · 上次测量");
}

function renderDevices() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const now = performance.now();
  const interacting = listHovered || elements.list.contains(document.activeElement);
  for (const [id, card] of cardNodes) {
    if (!devices.has(id)) { card.node.remove(); cardNodes.delete(id); }
  }
  listOrder = listOrder.filter((id) => devices.has(id));
  const newIds = [...devices.keys()].filter((id) => !cardNodes.has(id));
  for (const id of newIds) {
    cardNodes.set(id, createDeviceCard(devices.get(id), newIds.length <= 8));
    listOrder.push(id);
  }
  if (forceListSort || (!interacting && now - lastSortAt >= 1000)) {
    const sortMode = elements.sort.value;
    listOrder.sort((aId, bId) => {
      const a = devices.get(aId), b = devices.get(bId);
      if (sortMode === "name") return (a.name || "").localeCompare(b.name || "", "zh-CN");
      if (sortMode === "recent") return b.last_seen_ms - a.last_seen_ms;
      return (b.last_rssi ?? -999) - (a.last_rssi ?? -999);
    });
    lastSortAt = now;
    forceListSort = false;
  }
  // Reuse existing nodes. Only move them when the actual order changes.
  const scrollTop = elements.list.scrollTop;
  let nextNode = $("deviceEmpty").nextElementSibling;
  let visibleCount = 0;
  for (const id of listOrder) {
    const device = devices.get(id), card = cardNodes.get(id);
    const visible = !query || [device.name, device.address, device.possible_brand, ...(device.broadcast_companies || [])]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query));
    card.node.hidden = !visible;
    if (visible) { visibleCount++; updateDeviceCard(card, device); }
    if (card.node !== nextNode) elements.list.insertBefore(card.node, nextNode);
    else nextNode = nextNode.nextElementSibling;
  }
  $("deviceEmpty").hidden = visibleCount > 0;
  setText($("emptyTitle"), query ? "没有匹配的设备" : "暂无设备");
  elements.list.scrollTop = scrollTop;
}

function renderDetails() {
  const device = focused ? devices.get(focused) : null;
  const id = device?.id ?? null;
  const changed = renderedDetailId !== id;
  if (!device) {
    if (changed) {
      elements.detail.textContent = "请选择设备";
      elements.detail.className = "detail-empty";
    }
    renderedDetailId = id;
    return;
  }
  if (changed) {
    elements.detail.className = "detail-content";
    elements.detail.innerHTML = '<div class="detail-intro"><strong></strong><span class="detail-state"></span></div><dl class="detail-grid"></dl>';
    const grid = elements.detail.querySelector("dl");
    detailFields = ["设备地址", "广播名称", "Windows 已配对设备名", "系统名称", "广播厂商", "厂商编号", "可能品牌", "服务 UUID", "最后接收"].map((label, index) => {
      const field = document.createElement("div");
      field.className = "detail-field";
      const term = document.createElement("dt"), value = document.createElement("dd");
      term.textContent = label;
      if ([0, 5, 7].includes(index)) value.className = "mono";
      field.append(term, value);
      grid.append(field);
      return value;
    });
    if (!motionPreference.matches) elements.detail.animate([{ opacity: .25, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
  }
  renderedDetailId = id;
  setText(elements.detail.querySelector("strong"), device.name || "未命名设备");
  const state = freshness(device), badge = elements.detail.querySelector(".detail-state");
  badge.className = `detail-state ${state}`;
  setText(badge, state === "fresh" ? "最近收到" : state === "stale" ? "暂无新信号" : "未再检测到");
  const values = [
    device.address, device.advertised_name || "未提供", device.paired_name || "未提供", device.system_name || "未提供",
    broadcastCompany(device), device.company_ids?.length ? device.company_ids.join("、") : "未提供",
    device.possible_brand ? `${device.possible_brand}（${device.brand_source}）` : "未知",
    device.service_uuids?.length ? device.service_uuids.join("、") : "未提供", ageText(device.last_seen_ms),
  ];
  detailFields.forEach((field, index) => setText(field, values[index]));
}

Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
const chart = new Chart($("signalChart"), {
  type: "line",
  data: { datasets: [] },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: "nearest", intersect: false },
    elements: { point: { radius: 0, hitRadius: 8, hoverRadius: 4 }, line: { borderWidth: 2, tension: 0 } },
    plugins: { legend: { position: "bottom", labels: {
      usePointStyle: true, boxWidth: 8, padding: 18, color: "#6e6e73", font: { size: 11 },
      generateLabels: (instance) => Chart.defaults.plugins.legend.labels.generateLabels(instance).map((label) => {
        const characters = Array.from(label.text);
        return { ...label, text: characters.length > 18 ? characters.slice(0, 17).join("") + "…" : label.text };
      }),
    } }, tooltip: {
      callbacks: { title: (items) => items.length ? new Date(items[0].parsed.x).toLocaleTimeString("zh-CN", { hour12: false }) : "", label: (item) => `${item.dataset.label}: ${item.parsed.y} dBm` },
    } },
    scales: {
      x: { type: "linear", grid: { color: "#f0f0f3" }, border: { display: false }, ticks: { color: "#86868b", maxTicksLimit: 6, callback: (value) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) } },
      y: { suggestedMin: -100, suggestedMax: -20, grid: { color: "#f0f0f3" }, border: { display: false }, ticks: { color: "#86868b", callback: (value) => `${value} dBm` } },
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
  if (document.hidden) return;
  renderStatus();
  renderDevices();
  renderDetails();
  renderChart();
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener("open", () => {
    connected = true;
    renderStatus();
    scheduleRender();
    elements.connection.classList.add("online");
    elements.connection.querySelector("span:last-child").textContent = "本机已连接";
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") applySnapshot(message);
    if (message.type === "delta") applyDelta(message);
  });
  socket.addEventListener("close", () => {
    connected = false;
    renderStatus();
    scheduleRender();
    elements.connection.classList.remove("online");
    elements.connection.querySelector("span:last-child").textContent = "正在重连";
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });
}

async function scanCommand(action) {
  if (busy || !connected || !statusReceived) return;
  busy = action;
  transientNotice = null;
  renderStatus();
  try {
    const response = await fetch(`/api/scan/${action}`, { method: "POST" });
    const status = await response.json();
    if (!status.scan_state) throw new Error("服务未返回有效的扫描状态");
    applyStatus(status);
    if (!response.ok && !status.error) showTransientNotice(`扫描操作失败（${response.status}），请重试。`);
  } catch (error) {
    showTransientNotice(`无法完成扫描操作：${error.message}`);
  } finally {
    busy = false;
    renderStatus();
    scheduleRender();
  }
}

document.querySelectorAll("[data-scan-action]").forEach((button) => {
  button.addEventListener("click", () => scanCommand(button.dataset.scanAction));
});
elements.search.addEventListener("input", () => { forceListSort = true; scheduleRender(); });
elements.sort.addEventListener("change", () => { forceListSort = true; scheduleRender(); });
elements.list.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") listHovered = true; });
elements.list.addEventListener("pointerleave", () => { listHovered = false; scheduleRender(); });
elements.list.addEventListener("focusout", scheduleRender);
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
  $("timeRange").classList.toggle("long-window", windowSeconds === 300);
  document.querySelectorAll("[data-window]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  scheduleRender();
}));

// Progressive enhancement: content remains visible if observers are unavailable.
if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.remove("reveal-pending");
        revealObserver.unobserve(entry.target);
      }
    }
  }, { threshold: 0.05 });
  if (!motionPreference.matches) document.querySelectorAll(".reveal").forEach((node) => {
    node.classList.add("reveal-pending");
    revealObserver.observe(node);
  });
}
motionPreference.addEventListener("change", () => {
  if (motionPreference.matches) {
    document.querySelectorAll(".reveal-pending").forEach((node) => node.classList.remove("reveal-pending"));
    document.getAnimations().forEach((animation) => animation.cancel());
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleRender();
});
renderStatus();
fetch("/api/status").then((response) => response.json()).then((status) => {
  if (!statusReceived) applyStatus(status);
}).catch(() => {});
connect();
setInterval(scheduleRender, 1000);
