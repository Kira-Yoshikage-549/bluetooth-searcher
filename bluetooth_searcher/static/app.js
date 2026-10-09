"use strict";

const $ = (id) => document.getElementById(id);
const elements = {
  connection: $("connection"),
  radio: $("radioMetric"), scan: $("scanMetric"), fresh: $("freshCount"),
  total: $("deviceTotal"), notice: $("notice"), list: $("deviceList"),
  search: $("searchInput"), sort: $("sortSelect"), detail: $("detailContent"),
  chartEmpty: $("chartEmpty"),
};

const palette = ["#74FF9A", "#FFB23E", "#F08B48", "#D2C5A4"];
const dashStyles = [[], [8, 4], [3, 4], [10, 3, 2, 3]];
const numberFormat = new Intl.NumberFormat("zh-CN");
const timeFormat = new Intl.DateTimeFormat("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const devices = new Map();
const histories = new Map();
const selected = [];
const hiddenLines = new Set();
const lineSlots = new Map();
let focused = null;
let currentStatus = { scan_state: "stopped", radio_state: "unknown", error: null };
let socket = null;
let reconnectTimer = null;
let renderTimer = null;
let lastRenderAt = 0;
let windowSeconds = 60;
let dataPage = 1;
let dataSnapshot = null;
let dataDirty = false;
let lastDataOpen = false;
let explicitCompare = false;
let pendingReferences = true;
let pendingScroll = history.state?.scroll || null;
let searchTimer = null;
let scrollTimer = null;
let focusAfterRemoval = null;
let busy = false;
let autoSelected = false;
let transientNotice = null;
let connected = false;
let statusReceived = false;
let cardSequence = 0;
const cardNodes = new Map();
const legendNodes = new Map();
const cardHeights = new Map();
const estimatedCardHeight = 170;
let visibleIds = [];
let listFrame = null;
let restoringScroll = false;
let listOrder = [];
let lastSortAt = -Infinity;
let forceListSort = true;
let listHovered = false;
let listTouching = false;
let lastQuery = "";
let renderedDetailId;
let detailFields = [];
const heightObserver = "ResizeObserver" in window ? new ResizeObserver((entries) => {
  let changed = false;
  for (const entry of entries) {
    const id = entry.target.dataset.deviceId;
    const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize || entry.target.getBoundingClientRect().height) + 6;
    if (height > 6 && cardHeights.get(id) !== height) { cardHeights.set(id, height); changed = true; }
  }
  if (changed) requestListRender();
}) : null;
history.scrollRestoration = "manual";

function readUrl() {
  const params = new URLSearchParams(location.search);
  const sort = ["strength", "recent", "name"].includes(params.get("sort")) ? params.get("sort") : "strength";
  const seconds = params.get("window") === "300" ? 300 : 60;
  const ids = [...new Set(params.getAll("compare").filter(Boolean))].slice(0, 4);
  const hidden = [...new Set(params.getAll("hidden").filter(Boolean))];
  const rawPage = params.get("page");
  return { query: params.get("q") || "", sort, seconds, ids, hidden,
    explicit: params.has("compare"), focus: params.get("focus") || null,
    data: params.get("data") === "1", page: rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1 };
}

function applyUrlState(state) {
  elements.search.value = state.query;
  elements.sort.value = state.sort;
  windowSeconds = state.seconds;
  selected.splice(0, selected.length, ...state.ids);
  hiddenLines.clear();
  state.hidden.forEach((id) => hiddenLines.add(id));
  focused = state.focus;
  explicitCompare = state.explicit;
  autoSelected = state.explicit;
  dataPage = state.page;
  $("dataPanel").open = state.data;
  lastDataOpen = state.data;
  syncWindowControls();
  forceListSort = true;
  dataDirty = state.data;
}

function urlForState() {
  const params = new URLSearchParams();
  const query = elements.search.value.trim();
  if (query) params.set("q", query);
  if (elements.sort.value !== "strength") params.set("sort", elements.sort.value);
  if (windowSeconds !== 60) params.set("window", String(windowSeconds));
  if (selected.length) selected.forEach((id) => params.append("compare", id));
  else if (explicitCompare) params.set("compare", "");
  if (focused) params.set("focus", focused);
  selected.filter((id) => hiddenLines.has(id)).forEach((id) => params.append("hidden", id));
  if ($("dataPanel").open) {
    params.set("data", "1");
    if (dataPage > 1) params.set("page", String(dataPage));
  }
  return location.pathname + (params.size ? `?${params}` : "");
}

function listAnchor() {
  let offset = 0;
  for (const id of visibleIds) {
    const height = cardHeights.get(id) || estimatedCardHeight;
    if (offset + height > elements.list.scrollTop) return { id, offset: elements.list.scrollTop - offset };
    offset += height;
  }
  return null;
}

function scrollState() {
  return { pageY: window.scrollY, list: listAnchor() };
}

function saveScroll() {
  if (restoringScroll || pendingScroll) return;
  history.replaceState({ ...history.state, scroll: scrollState() }, "", location.href);
}

function writeUrl(mode = "push") {
  saveScroll();
  const url = urlForState();
  const scroll = pendingScroll || scrollState();
  if (mode === "push" && url !== location.pathname + location.search) history.pushState({ scroll }, "", url);
  else history.replaceState({ ...history.state, scroll }, "", url);
}

function syncWindowControls() {
  $("timeRange").classList.toggle("long-window", windowSeconds === 300);
  const knob = $("windowKnob");
  if (knob) {
    knob.dataset.windowSeconds = String(windowSeconds);
    knob.setAttribute("aria-label", `当前时间范围 ${windowSeconds === 300 ? "5 分钟" : "60 秒"}，切换至 ${windowSeconds === 300 ? "60 秒" : "5 分钟"}`);
  }
  if ($("knobValue")) setText($("knobValue"), windowSeconds === 300 ? "300 SEC" : "060 SEC");
  document.querySelectorAll(".knob-detent").forEach((label) => {
    label.classList.toggle("active", Number(label.dataset.detent) === windowSeconds);
  });
}

applyUrlState(readUrl());

function setText(node, value) {
  const text = String(value ?? "");
  if (node.textContent !== text) node.textContent = text;
}

function ageText(timeMs) {
  const age = Math.max(0, Math.floor((Date.now() - timeMs) / 1000));
  if (age < 2) return "刚刚收到";
  if (age < 60) return `${numberFormat.format(age)} 秒前`;
  return `${numberFormat.format(Math.floor(age / 60))} 分钟前`;
}

function freshness(device) {
  const age = Date.now() - device.last_seen_ms;
  if (age < 5000) return "fresh";
  if (age < 30000) return "stale";
  return "missing";
}

function strength(rssi) {
  if (!Number.isFinite(rssi)) return { key: "unknown", text: "未知", segments: 0 };
  if (rssi >= -60) return { key: "strong", text: "强", segments: 12 };
  if (rssi >= -80) return { key: "medium", text: "中", segments: Math.min(11, Math.max(5, Math.round(((rssi + 100) / 40) * 12))) };
  return { key: "weak", text: "弱", segments: Math.min(4, Math.max(1, Math.round(((rssi + 110) / 30) * 4))) };
}

function broadcastCompany(device) {
  if (!device.company_ids?.length) return "未提供";
  return device.broadcast_companies.map((name, index) =>
    name === "未知厂商" ? `${name} (${device.company_ids[index]})` : name).join("、");
}

function setNotice(text, tone = "neutral") {
  setText(elements.notice, text);
  elements.notice.dataset.tone = tone;
  elements.notice.classList.toggle("is-empty", !text);
}

function showTransientNotice(text, tone = "error") {
  transientNotice = { text, tone, until: Date.now() + 4500 };
  scheduleRender();
}

function applyStatus(status) {
  statusReceived = true;
  currentStatus = status;
  const handoffActive = document.documentElement.hasAttribute("data-scan-transition");
  window.ScanTransition?.onStatus(status);
  if (handoffActive && status.scan_state !== "scanning") renderStatus();
  scheduleRender();
}

function applySnapshot(message) {
  const previousOrder = visibleIds.slice();
  const firstSnapshot = pendingReferences;
  devices.clear();
  histories.clear();
  for (const device of message.devices || []) devices.set(device.id, device);
  for (const [id, samples] of Object.entries(message.history || {})) histories.set(id, samples);
  const hadMissing = selected.some((id) => !devices.has(id)) || (focused && !devices.has(focused)) || [...hiddenLines].some((id) => !devices.has(id));
  for (let index = selected.length - 1; index >= 0; index--) {
    if (!devices.has(selected[index])) selected.splice(index, 1);
  }
  for (const id of hiddenLines) if (!devices.has(id) || !selected.includes(id)) hiddenLines.delete(id);
  if (focused && !devices.has(focused)) {
    const index = previousOrder.indexOf(focused);
    focusAfterRemoval = pendingReferences ? null : (previousOrder.slice(index + 1).find((id) => devices.has(id)) || previousOrder.slice(0, index).reverse().find((id) => devices.has(id)) || "search");
    focused = focusAfterRemoval && focusAfterRemoval !== "search" ? focusAfterRemoval : null;
  }
  for (const id of lineSlots.keys()) if (!selected.includes(id)) lineSlots.delete(id);
  if (pendingReferences && hadMissing) showTransientNotice("链接中的设备已失效，请重新选择。", "neutral");
  else if (hadMissing && focusAfterRemoval) showTransientNotice("设备已离开，焦点已移至相邻设备。", "neutral");
  pendingReferences = false;
  selectFirstDevice();
  if (hadMissing || urlForState() !== location.pathname + location.search) writeUrl("replace");
  if ($("dataPanel").open && (firstSnapshot || hadMissing)) buildDataSnapshot(false);
  applyStatus(message.status);
}

function applyDelta(message) {
  const previousOrder = visibleIds.slice();
  let selectionChanged = false;
  const hadSelection = selected.length;
  for (const id of message.removed || []) {
    devices.delete(id);
    histories.delete(id);
    const index = selected.indexOf(id);
    if (index >= 0) { selected.splice(index, 1); selectionChanged = true; }
    hiddenLines.delete(id);
    lineSlots.delete(id);
    if (focused === id) {
      const position = previousOrder.indexOf(id);
      focusAfterRemoval = previousOrder.slice(position + 1).find((item) => item !== id && !message.removed.includes(item)) || previousOrder.slice(0, position).reverse().find((item) => !message.removed.includes(item)) || "search";
      focused = focusAfterRemoval === "search" ? null : focusAfterRemoval;
      showTransientNotice("设备已离开，焦点已移至相邻设备。", "neutral");
    }
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
  if (selectionChanged || (message.removed || []).length || (!hadSelection && selected.length)) {
    if ($("dataPanel").open) buildDataSnapshot(true);
    writeUrl("replace");
  }
  applyStatus(message.status);
}

function selectFirstDevice() {
  if (autoSelected || explicitCompare || !devices.size) return;
  const newest = [...devices.values()].sort((a, b) => b.last_seen_ms - a.last_seen_ms)[0];
  selected.push(newest.id);
  focused = newest.id;
  autoSelected = true;
  assignLineSlots();
}

function assignLineSlots() {
  for (const id of lineSlots.keys()) if (!selected.includes(id)) lineSlots.delete(id);
  for (const id of selected) {
    if (!lineSlots.has(id)) lineSlots.set(id, [0, 1, 2, 3].find((slot) => ![...lineSlots.values()].includes(slot)) ?? 0);
  }
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
  const startLabel = busy === "start" ? "开始扫描" :
    !statusReceived && window.ScanTransition?.entryState() === "scanning" ? "扫描中" :
    !connected ? "连接中" : scanning ? "扫描中" : "开始扫描";
  const freshCount = [...devices.values()].filter((device) => freshness(device) === "fresh").length;
  const radioState = connected && statusReceived ? currentStatus.radio_state || "unknown" : "unknown";
  setText(elements.radio, radioLabels[radioState] || "未知");
  setText(elements.scan, busy ? (busy === "start" ? "正在启动" : "正在停止") : connected ? scanLabels[currentStatus.scan_state] || "待命" : "连接中");
  setText(elements.fresh, numberFormat.format(freshCount));
  setText(elements.total, numberFormat.format(devices.size));
  elements.radio.dataset.state = radioState;
  elements.scan.dataset.state = busy ? "busy" : !connected ? "connecting" : currentStatus.scan_state;
  elements.fresh.dataset.state = freshCount ? "fresh" : "idle";
  elements.total.dataset.state = devices.size ? "fresh" : "idle";
  document.querySelectorAll("[data-scan-action]").forEach((button) => {
    const start = button.dataset.scanAction === "start";
    if (start) {
      setText(button.querySelector(".button-label"), startLabel);
      button.classList.toggle("is-scanning", startLabel === "扫描中");
    }
    button.disabled = !!busy || !connected || !statusReceived || (start ? scanning : !scanning);
    button.setAttribute("aria-busy", String(busy === button.dataset.scanAction));
    button.classList.toggle("is-busy", busy === button.dataset.scanAction);
  });
  if (transientNotice && Date.now() < transientNotice.until) setNotice(transientNotice.text, transientNotice.tone);
  else if (currentStatus.error) setNotice(currentStatus.error, "error");
  else setNotice("");
}

function createDeviceCard(device) {
  const node = document.createElement("article");
  node.className = "device-card";
  node.dataset.deviceId = device.id;
  node.innerHTML = `<button type="button" class="device-open">
    <div class="device-top"><span class="device-name"></span><span class="signal-value"><span class="rssi-number"></span><small>&nbsp;dBm</small></span></div>
    <div class="device-meta"><span class="mono" translate="no"></span><span class="meta-dot">·</span><span class="device-age"></span></div>
    <div class="device-bottom"><div class="signal-track" aria-hidden="true">${'<span class="signal-segment"></span>'.repeat(12)}</div><span class="strength-label"></span></div>
    <div class="device-company"><span class="company-value"></span><span class="brand-hint"></span></div>
    <div class="stale-tag" hidden></div>
    <span class="sr-only device-reading"></span>
  </button>
  <label class="compare-control" title="加入或移出信号对比"><input type="checkbox" name="compare" autocomplete="off"><span>对比</span></label>`;
  const card = { node };
  for (const [key, selector] of Object.entries({
    button: ".device-open", name: ".device-name", rssi: ".rssi-number", address: ".mono",
    age: ".device-age", track: ".signal-track", strength: ".strength-label",
    company: ".company-value", brand: ".brand-hint", stale: ".stale-tag", checkbox: "input", reading: ".device-reading",
  })) card[key] = node.querySelector(selector);
  card.button.dataset.id = device.id;
  card.checkbox.dataset.id = device.id;
  card.reading.id = `device-reading-${++cardSequence}`;
  card.button.setAttribute("aria-describedby", card.reading.id);
  card.checkbox.setAttribute("aria-describedby", card.reading.id);
  card.segments = [...card.track.children];
  return card;
}

function updateDeviceCard(card, device) {
  const name = device.name || "未命名设备";
  const state = freshness(device);
  const signal = strength(device.last_rssi);
  for (const key of ["fresh", "stale", "missing"]) card.node.classList.toggle(key, state === key);
  card.node.classList.toggle("focused", focused === device.id);
  card.button.setAttribute("aria-label", `查看 ${name} 的详情`);
  card.button.setAttribute("aria-pressed", String(focused === device.id));
  card.checkbox.setAttribute("aria-label", `对比 ${name}`);
  card.checkbox.checked = selected.includes(device.id);
  setText(card.name, name);
  card.name.title = name;
  setText(card.rssi, device.last_rssi == null ? "—" : numberFormat.format(device.last_rssi));
  card.rssi.parentElement.dataset.strength = signal.key;
  setText(card.address, device.address || "地址未知");
  setText(card.age, ageText(device.last_seen_ms));
  card.track.dataset.strength = signal.key;
  card.segments.forEach((segment, index) => segment.classList.toggle("lit", index < signal.segments));
  setText(card.strength, signal.text);
  setText(card.company, `广播厂商：${broadcastCompany(device)}`);
  card.company.title = broadcastCompany(device);
  setText(card.brand, device.possible_brand ? `可能 ${device.possible_brand}` : "");
  card.stale.hidden = state === "fresh";
  setText(card.stale, state === "stale" ? "暂无新信号 · 上次测量" : "未再检测到 · 上次测量");
  const reading = device.last_rssi == null ? "暂无信号读数" : `上次信号强度 ${numberFormat.format(device.last_rssi)} dBm，${signal.text}信号`;
  const reception = state === "fresh" ? "最近收到" : state === "stale" ? "暂无新信号" : "未再检测到";
  setText(card.reading, `${reception}，${reading}，最后接收 ${ageText(device.last_seen_ms)}，设备地址 ${device.address || "未知"}`);
}

function requestListRender() {
  if (listFrame) return;
  listFrame = requestAnimationFrame(() => { listFrame = null; renderDevices(); });
}

function offsetFor(id) {
  let offset = 0;
  for (const item of visibleIds) {
    if (item === id) return offset;
    offset += cardHeights.get(item) || estimatedCardHeight;
  }
  return null;
}

function renderDevices() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const anchor = listAnchor();
  const oldIds = visibleIds;
  const now = performance.now();
  const interacting = listHovered || listTouching || elements.list.contains(document.activeElement);
  const known = new Set(listOrder);
  listOrder = listOrder.filter((id) => devices.has(id));
  for (const id of devices.keys()) if (!known.has(id)) listOrder.push(id);
  if (forceListSort || (!interacting && now - lastSortAt >= 1000)) {
    const sortMode = elements.sort.value;
    listOrder.sort((aId, bId) => {
      const a = devices.get(aId), b = devices.get(bId);
      if (sortMode === "name") return (a.name || "").localeCompare(b.name || "", "zh-CN") || aId.localeCompare(bId);
      if (sortMode === "recent") return b.last_seen_ms - a.last_seen_ms || aId.localeCompare(bId);
      return (b.last_rssi ?? -999) - (a.last_rssi ?? -999) || aId.localeCompare(bId);
    });
    lastSortAt = now;
    forceListSort = false;
  }
  visibleIds = listOrder.filter((id) => {
    const device = devices.get(id);
    return !query || [device.name, device.address, device.possible_brand, ...(device.broadcast_companies || [])]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query));
  });
  const changed = oldIds.length !== visibleIds.length || oldIds.some((id, index) => id !== visibleIds[index]);
  if (query !== lastQuery) elements.list.scrollTop = 0;
  else if (changed && anchor) {
    const offset = offsetFor(anchor.id);
    if (offset !== null) elements.list.scrollTop = offset + anchor.offset;
  }
  lastQuery = query;
  let activeCard = document.activeElement?.closest?.(".device-card");
  if (activeCard && !visibleIds.includes(activeCard.dataset.deviceId)) {
    elements.search.focus();
    activeCard = null;
  }
  const empty = $("deviceEmpty");
  empty.hidden = visibleIds.length > 0;
  const emptyMessage = query ? "没有匹配的设备，请修改搜索内容" :
    !connected || !statusReceived ? "正在连接本机服务，请稍候；服务未启动时请运行 start.bat" :
    currentStatus.scan_state === "scanning" ? "正在接收 BLE 广播，等待附近设备发送信号" :
    currentStatus.scan_state === "error" ? "扫描暂不可用，请查看上方提示并重试" :
    "暂无设备，点击“开始扫描”接收附近信号";
  setText($("emptyTitle"), emptyMessage);
  if (!visibleIds.length) {
    $("listTop").style.height = "0px";
    $("listBottom").style.height = "0px";
    for (const [id, card] of cardNodes) { heightObserver?.unobserve(card.node); card.node.remove(); cardNodes.delete(id); }
    if (focusAfterRemoval) { focusAfterRemoval = null; requestAnimationFrame(() => elements.search.focus()); }
    if (pendingScroll && !pendingScroll.list?.id) {
      const saved = pendingScroll;
      pendingScroll = null;
      requestAnimationFrame(() => window.scrollTo({ top: saved.pageY || 0, behavior: "instant" }));
    }
    return;
  }
  const offsets = [0];
  for (const id of visibleIds) offsets.push(offsets.at(-1) + (cardHeights.get(id) || estimatedCardHeight));
  const top = elements.list.scrollTop;
  const bottom = top + elements.list.clientHeight;
  let first = 0;
  while (first < visibleIds.length && offsets[first + 1] < top) first++;
  let last = first;
  while (last < visibleIds.length && offsets[last] < bottom) last++;
  const start = Math.max(0, first - 4);
  const end = Math.min(visibleIds.length, last + 4);
  $("listTop").style.height = `${offsets[start]}px`;
  $("listBottom").style.height = `${offsets.at(-1) - offsets[end]}px`;
  const wanted = new Set(visibleIds.slice(start, end));
  if (activeCard && devices.has(activeCard.dataset.deviceId)) wanted.add(activeCard.dataset.deviceId);
  for (const [id, card] of cardNodes) {
    if (!wanted.has(id)) { heightObserver?.unobserve(card.node); card.node.remove(); cardNodes.delete(id); }
  }
  const bottomSpacer = $("listBottom");
  let nextNode = bottomSpacer;
  for (let index = end - 1; index >= start; index--) {
    const id = visibleIds[index];
    let card = cardNodes.get(id);
    if (!card) { card = createDeviceCard(devices.get(id)); cardNodes.set(id, card); heightObserver?.observe(card.node); }
    card.node.classList.remove("focus-pin");
    card.node.style.transform = "";
    updateDeviceCard(card, devices.get(id));
    if (card.node.nextSibling !== nextNode) elements.list.insertBefore(card.node, nextNode);
    nextNode = card.node;
  }
  if (activeCard && wanted.has(activeCard.dataset.deviceId) && !visibleIds.slice(start, end).includes(activeCard.dataset.deviceId)) {
    const card = cardNodes.get(activeCard.dataset.deviceId);
    const offset = offsetFor(activeCard.dataset.deviceId);
    if (card && offset !== null) {
      card.node.classList.add("focus-pin");
      card.node.style.transform = `translateY(${offset}px)`;
      updateDeviceCard(card, devices.get(activeCard.dataset.deviceId));
      elements.list.append(card.node);
    }
  }
  if (focusAfterRemoval) {
    const target = focusAfterRemoval;
    focusAfterRemoval = null;
    requestAnimationFrame(() => target === "search" ? elements.search.focus() : focusCardControl(target, "button"));
  }
  if (pendingScroll) {
    const saved = pendingScroll;
    pendingScroll = null;
    restoringScroll = true;
    const offset = saved.list?.id ? offsetFor(saved.list.id) : null;
    if (offset !== null) elements.list.scrollTop = offset + saved.list.offset;
    requestAnimationFrame(() => {
      window.scrollTo({ top: saved.pageY || 0, behavior: "instant" });
      restoringScroll = false;
      requestListRender();
    });
  }
}

function focusCardControl(id, control) {
  if (offsetFor(id) === null) { elements.search.focus(); return; }
  for (let attempt = 0; attempt < 3 && !cardNodes.has(id); attempt++) {
    elements.list.scrollTop = offsetFor(id);
    renderDevices();
  }
  if (!cardNodes.has(id)) {
    elements.list.scrollTop = offsetFor(id);
    renderDevices();
  }
  (cardNodes.get(id)?.[control] || elements.search).focus();
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
    detailFields = ["设备地址", "上次信号强度", "广播名称", "Windows 已配对设备名", "系统名称", "广播厂商", "厂商编号", "可能品牌", "服务 UUID", "最后接收"].map((label, index) => {
      const field = document.createElement("div");
      field.className = "detail-field";
      const term = document.createElement("dt"), value = document.createElement("dd");
      term.textContent = label;
      if ([0, 1, 6, 8].includes(index)) value.className = "mono";
      field.append(term, value);
      grid.append(field);
      return value;
    });
  }
  renderedDetailId = id;
  setText(elements.detail.querySelector("strong"), device.name || "未命名设备");
  const state = freshness(device), badge = elements.detail.querySelector(".detail-state");
  badge.className = `detail-state ${state}`;
  setText(badge, state === "fresh" ? "最近收到" : state === "stale" ? "暂无新信号" : "未再检测到");
  const values = [
    device.address, device.last_rssi == null ? "未提供" : `${numberFormat.format(device.last_rssi)}\u00a0dBm · ${strength(device.last_rssi).text}`,
    device.advertised_name || "未提供", device.paired_name || "未提供", device.system_name || "未提供",
    broadcastCompany(device), device.company_ids?.length ? device.company_ids.join("、") : "未提供",
    device.possible_brand ? `${device.possible_brand}（${device.brand_source}）` : "未知",
    device.service_uuids?.length ? device.service_uuids.join("、") : "未提供", ageText(device.last_seen_ms),
  ];
  detailFields.forEach((field, index) => setText(field, values[index]));
}

Chart.defaults.font.family = '"IBM Plex Mono", "Microsoft YaHei", monospace';
Chart.defaults.color = "#D2C5A4";
const chart = new Chart($("signalChart"), {
  type: "line",
  data: { datasets: [] },
  options: {
    onResize: (instance, size) => { instance.options.scales.x.ticks.maxTicksLimit = size.width < 360 ? 3 : 6; },
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: "nearest", intersect: false },
    elements: { point: { radius: 0, hitRadius: 8, hoverRadius: 4 }, line: { borderWidth: 2, tension: 0 } },
    plugins: { legend: { display: false }, tooltip: {
      backgroundColor: "#141E17", borderColor: "#64745B", borderWidth: 1,
      titleColor: "#74FF9A", bodyColor: "#D2C5A4", cornerRadius: 2,
      callbacks: { title: (items) => items.length ? timeFormat.format(items[0].parsed.x) : "", label: (item) => `${item.dataset.label}: ${numberFormat.format(item.parsed.y)}\u00a0dBm` },
    } },
    scales: {
      x: { type: "linear", grid: { color: "#26392B" }, border: { display: false }, ticks: { color: "#C0D2B7", maxTicksLimit: 6, callback: (value) => timeFormat.format(value) } },
      y: { suggestedMin: -100, suggestedMax: -20, grid: { color: "#26392B" }, border: { display: false }, ticks: { color: "#C0D2B7", callback: (value) => `${numberFormat.format(value)}\u00a0dBm` } },
    },
  },
});
document.fonts?.ready.then(() => { chart.resize(); chart.update("none"); });

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
  assignLineSlots();
  chart.options.scales.x.min = cutoff;
  chart.options.scales.x.max = now;
  chart.data.datasets = selected.map((id) => {
    const device = devices.get(id);
    const slot = lineSlots.get(id);
    return {
      label: device?.name || id,
      data: chartPoints(histories.get(id) || [], cutoff, now),
      borderColor: palette[slot], backgroundColor: palette[slot], pointBackgroundColor: palette[slot],
      borderDash: dashStyles[slot], hidden: hiddenLines.has(id), spanGaps: false,
    };
  });
  const visibleDatasets = chart.data.datasets.filter((dataset) => !dataset.hidden);
  elements.chartEmpty.hidden = visibleDatasets.some((dataset) => dataset.data.some((point) => point.y !== null));
  const chartMessage = selected.length && !visibleDatasets.length ? "曲线已全部隐藏；点击下方图例恢复，或查看数据" :
    selected.length ? "当前时间范围暂无采样；可查看数据或等待新信号" : "选择设备后显示曲线";
  setText(elements.chartEmpty.querySelector("strong"), chartMessage);
  renderLegend();
  chart.update("none");
}

function renderLegend() {
  const container = $("chartLegend");
  for (const [id, button] of legendNodes) if (!selected.includes(id)) { button.remove(); legendNodes.delete(id); }
  let nextNode = null;
  for (const id of selected.slice().reverse()) {
    const device = devices.get(id);
    if (!device) continue;
    let button = legendNodes.get(id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "legend-button";
      button.dataset.id = id;
      button.innerHTML = '<span class="legend-line" aria-hidden="true"></span><span class="legend-name"></span>';
      legendNodes.set(id, button);
    }
    const name = device.name || "未命名设备";
    const slot = lineSlots.get(id);
    const line = button.querySelector(".legend-line");
    line.style.background = slot === 0 ? palette[slot] : `repeating-linear-gradient(to right, ${palette[slot]} 0 ${slot === 1 ? 8 : slot === 2 ? 3 : 10}px, transparent ${slot === 1 ? 8 : slot === 2 ? 3 : 10}px ${slot === 1 ? 12 : slot === 2 ? 7 : 14}px)`;
    line.style.borderColor = palette[slot];
    setText(button.querySelector(".legend-name"), name);
    button.title = `${name} · ${id}`;
    button.setAttribute("aria-label", `${hiddenLines.has(id) ? "显示" : "隐藏"} ${name}（${id}）曲线`);
    button.setAttribute("aria-pressed", String(!hiddenLines.has(id)));
    if (button.parentNode !== container || button.nextSibling !== nextNode) container.insertBefore(button, nextNode);
    nextNode = button;
  }
}

function buildDataSnapshot(resetPage) {
  if (resetPage) dataPage = 1;
  const now = currentStatus.scan_state === "scanning" ? Date.now() : (currentStatus.stopped_at_ms || Date.now());
  const cutoff = now - windowSeconds * 1000;
  const rows = [];
  const stats = [];
  for (const id of selected) {
    const device = devices.get(id);
    if (!device) continue;
    const samples = (histories.get(id) || []).filter((sample) => sample.time_ms >= cutoff && sample.time_ms <= now && Number.isFinite(sample.rssi));
    stats.push({ id, name: device.name || "未命名设备", count: samples.length,
      latest: samples.at(-1)?.rssi, min: samples.length ? Math.min(...samples.map((item) => item.rssi)) : null,
      max: samples.length ? Math.max(...samples.map((item) => item.rssi)) : null });
    for (const sample of samples) rows.push({ ...sample, id, name: device.name || "未命名设备", address: device.address || id });
  }
  rows.sort((a, b) => b.time_ms - a.time_ms || a.id.localeCompare(b.id));
  dataSnapshot = { time: now, rows, stats };
  const requestedPage = dataPage;
  dataPage = Math.min(dataPage, Math.max(1, Math.ceil(rows.length / 50)));
  dataDirty = true;
  renderDataPanel();
  if (requestedPage !== dataPage) writeUrl("replace");
}

function renderDataPanel() {
  if (!$("dataPanel").open || !dataDirty) return;
  if (!dataSnapshot) buildDataSnapshot(false);
  const snapshot = dataSnapshot;
  dataDirty = false;
  setText($("dataSnapshotTime"), `数据快照：${dateFormat.format(snapshot.time)}`);
  const summary = $("dataSummary");
  summary.replaceChildren();
  for (const stat of snapshot.stats) {
    const card = document.createElement("div");
    card.className = "data-stat";
    const name = document.createElement("strong"), values = document.createElement("span");
    name.textContent = stat.name;
    values.textContent = stat.count ? `最新 ${numberFormat.format(stat.latest)}\u00a0dBm · 最小 ${numberFormat.format(stat.min)}\u00a0dBm · 最大 ${numberFormat.format(stat.max)}\u00a0dBm · ${numberFormat.format(stat.count)} 条` : "当前窗口无样本";
    card.append(name, values); summary.append(card);
  }
  const empty = $("dataEmpty");
  empty.hidden = snapshot.rows.length > 0;
  setText(empty, !selected.length ? "尚未选择设备。请从左侧列表选择设备后查看采样。" : "当前时间范围没有采样。请等待新信号，或切换到 5 分钟后刷新数据。");
  $("dataTable").hidden = !snapshot.rows.length;
  const totalPages = Math.max(1, Math.ceil(snapshot.rows.length / 50));
  dataPage = Math.min(dataPage, totalPages);
  const body = $("dataRows");
  body.replaceChildren();
  for (const sample of snapshot.rows.slice((dataPage - 1) * 50, dataPage * 50)) {
    const row = document.createElement("tr");
    for (const value of [dateFormat.format(sample.time_ms), `${sample.name} · ${sample.address}`, `${numberFormat.format(sample.rssi)}\u00a0dBm`]) {
      const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
    }
    row.cells[1].setAttribute("translate", "no");
    body.append(row);
  }
  $("previousPage").disabled = dataPage <= 1;
  $("nextPage").disabled = dataPage >= totalPages;
  setText($("pageStatus"), `第 ${numberFormat.format(dataPage)} / ${numberFormat.format(totalPages)} 页`);
}

function render() {
  if (document.hidden) return;
  renderStatus();
  renderDevices();
  renderDetails();
  renderChart();
  renderDataPanel();
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener("open", () => {
    connected = true;
    renderStatus();
    scheduleRender();
    elements.connection.classList.add("online");
    elements.connection.dataset.state = "online";
    elements.connection.querySelector("span:last-child").textContent = "本机已连接";
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") applySnapshot(message);
    if (message.type === "delta") applyDelta(message);
  });
  socket.addEventListener("close", () => {
    connected = false;
    statusReceived = false;
    renderStatus();
    scheduleRender();
    elements.connection.classList.remove("online");
    elements.connection.dataset.state = "connecting";
    elements.connection.querySelector("span:last-child").textContent = "正在重连";
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });
  socket.addEventListener("error", () => { elements.connection.dataset.state = "error"; });
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
elements.search.addEventListener("input", () => {
  forceListSort = true;
  requestListRender();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => writeUrl("replace"), 250);
});
elements.sort.addEventListener("change", () => { forceListSort = true; writeUrl(); scheduleRender(); });
elements.list.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") listHovered = true; });
elements.list.addEventListener("pointerleave", () => { listHovered = false; scheduleRender(); });
elements.list.addEventListener("touchstart", () => { listTouching = true; }, { passive: true });
function releaseListInteraction() {
  listTouching = false;
  listHovered = false;
  scheduleRender();
}
elements.list.addEventListener("touchend", () => { setTimeout(releaseListInteraction, 250); }, { passive: true });
elements.list.addEventListener("touchcancel", releaseListInteraction, { passive: true });
window.addEventListener("blur", releaseListInteraction);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseListInteraction(); });
elements.list.addEventListener("focusout", scheduleRender);
elements.list.addEventListener("scroll", () => {
  requestListRender();
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(saveScroll, 120);
}, { passive: true });
window.addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(saveScroll, 120);
}, { passive: true });
elements.list.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const card = event.target.closest(".device-card");
  if (!card) return;
  const index = visibleIds.indexOf(card.dataset.deviceId);
  if (index < 0) return;
  event.preventDefault();
  if (event.shiftKey) {
    if (event.target.matches("input")) card.querySelector(".device-open").focus();
    else if (index) focusCardControl(visibleIds[index - 1], "checkbox");
    else elements.sort.focus();
  } else if (event.target.matches(".device-open")) card.querySelector("input").focus();
  else if (index < visibleIds.length - 1) focusCardControl(visibleIds[index + 1], "button");
  else $("windowKnob").focus();
});
function selectionChanged() {
  explicitCompare = true;
  autoSelected = true;
  assignLineSlots();
  if ($("dataPanel").open) buildDataSnapshot(true);
  writeUrl();
  scheduleRender();
}
elements.list.addEventListener("click", (event) => {
  const button = event.target.closest(".device-open");
  if (!button) return;
  const id = button.dataset.id;
  if (!devices.has(id)) return;
  focused = id;
  if (!selected.includes(id)) {
    if (selected.length < 4) selected.push(id);
    else showTransientNotice("最多同时对比 4 台设备。");
  }
  selectionChanged();
});
elements.list.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".compare-control input");
  if (!checkbox) return;
  const id = checkbox.dataset.id;
  if (!devices.has(id)) return;
  const index = selected.indexOf(id);
  if (index >= 0) selected.splice(index, 1);
  else if (selected.length < 4) { selected.push(id); focused = id; }
  else { checkbox.checked = false; showTransientNotice("最多同时对比 4 台设备。"); }
  selectionChanged();
});
function setWindow(seconds) {
  if (windowSeconds === seconds) return;
  windowSeconds = seconds;
  syncWindowControls();
  window.ScanTransition?.switchChannel();
  if ($("dataPanel").open) buildDataSnapshot(true);
  writeUrl();
  scheduleRender();
}
$("windowKnob").addEventListener("click", () => setWindow(windowSeconds === 300 ? 60 : 300));
$("windowKnob").addEventListener("keydown", (event) => {
  if (event.key === "Tab" && event.shiftKey && visibleIds.length) {
    event.preventDefault();
    focusCardControl(visibleIds.at(-1), "checkbox");
    return;
  }
  const shortKeys = ["ArrowLeft", "ArrowDown", "Home"];
  const longKeys = ["ArrowRight", "ArrowUp", "End"];
  if (!shortKeys.includes(event.key) && !longKeys.includes(event.key)) return;
  event.preventDefault();
  setWindow(shortKeys.includes(event.key) ? 60 : 300);
});
$("chartLegend").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const id = button.dataset.id;
  if (hiddenLines.has(id)) hiddenLines.delete(id);
  else hiddenLines.add(id);
  writeUrl();
  scheduleRender();
});
$("dataPanel").addEventListener("toggle", () => {
  if ($("dataPanel").open === lastDataOpen) return;
  lastDataOpen = $("dataPanel").open;
  if ($("dataPanel").open && !dataSnapshot) buildDataSnapshot(false);
  writeUrl();
});
$("refreshData").addEventListener("click", () => { buildDataSnapshot(true); writeUrl(); });
$("previousPage").addEventListener("click", () => { if (dataPage > 1) { dataPage--; dataDirty = true; renderDataPanel(); writeUrl(); } });
$("nextPage").addEventListener("click", () => {
  if (dataSnapshot && dataPage < Math.ceil(dataSnapshot.rows.length / 50)) { dataPage++; dataDirty = true; renderDataPanel(); writeUrl(); }
});
window.addEventListener("popstate", (event) => {
  clearTimeout(searchTimer);
  applyUrlState(readUrl());
  pendingScroll = event.state?.scroll || { pageY: 0, list: null };
  if (!pendingReferences) {
    let invalid = false;
    for (let index = selected.length - 1; index >= 0; index--) if (!devices.has(selected[index])) { selected.splice(index, 1); invalid = true; }
    if (focused && !devices.has(focused)) { focused = null; invalid = true; }
    for (const id of hiddenLines) if (!devices.has(id) || !selected.includes(id)) { hiddenLines.delete(id); invalid = true; }
    if (invalid) { showTransientNotice("链接中的设备已失效，请重新选择。", "neutral"); writeUrl("replace"); }
  }
  assignLineSlots();
  dataSnapshot = null;
  if ($("dataPanel").open) buildDataSnapshot(false);
  scheduleRender();
});

window.addEventListener("scan-entry-expired", renderStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleRender();
});
renderStatus();
fetch("/api/status").then((response) => response.json()).then((status) => {
  if (!statusReceived) applyStatus(status);
}).catch(() => {});
connect();
setInterval(scheduleRender, 1000);
