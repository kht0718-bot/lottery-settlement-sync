const state = {
  token: localStorage.getItem("webToken") || "",
  user: null,
  settlements: [],
  editingId: null,
  attachments: [],
  photoScale: 1,
};

const $ = (id) => document.getElementById(id);
const LOTTERY_PRODUCTS = ["스피또500", "스피또1000", "스피또2000", "연금복권"];
const pageTitles = { home: "홈", history: "내역", inventory: "재고", manage: "관리" };

const api = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("webToken");
      state.token = "";
      state.user = null;
      showLogin();
    }
    throw new Error(data.message || "요청을 처리하지 못했습니다.");
  }
  return data;
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const num = (value) => Math.max(0, Number(value || 0));
const money = (value) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const dateTime = (value) => value ? new Date(Number(value)).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "-";
const today = () => new Date().toISOString().slice(0, 10);
const setMessage = (id, text, type = "muted") => { const element = $(id); if (element) { element.textContent = text; element.className = type; } };
const rowKey = (item) => `${String(item.product || "").trim()}|${String(item.draw || "").trim()}`;

function showLogin() {
  $("loginView")?.classList.remove("hidden");
  $("appView")?.classList.add("hidden");
}

function showApp() {
  $("loginView")?.classList.add("hidden");
  $("appView")?.classList.remove("hidden");
  const roleLabel = state.user?.role === "admin" ? "관리자" : "직원";
  const name = state.user?.staffName || state.user?.username || "사용자";
  $("userInfo").textContent = `${name} · ${roleLabel}`;
  $("avatar").textContent = name.slice(0, 1);
  $("employeeHome")?.classList.toggle("hidden", state.user?.role === "admin");
  $("adminHome")?.classList.toggle("hidden", state.user?.role !== "admin");
  $("adminManage")?.classList.toggle("hidden", state.user?.role !== "admin");
  $("employeeOnlyManage")?.classList.toggle("hidden", state.user?.role === "admin");
  loadHome();
}

function setPage(view) {
  const normalized = pageTitles[view] ? view : "home";
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.id === `${normalized}Page`));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === normalized));
  $("pageTitle").textContent = pageTitles[normalized];
  if (normalized === "history") loadHistory();
  if (normalized === "inventory") loadInventory();
  if (normalized === "manage" && state.user?.role === "admin") { loadApproval(); loadStaff(); loadDevices(); }
}

function setShift(shift) {
  document.querySelectorAll("[data-shift]").forEach((button) => button.classList.toggle("active", button.dataset.shift === shift));
  $("prePane")?.classList.toggle("active", shift === "pre");
  $("postPane")?.classList.toggle("active", shift === "post");
  $("postDetails")?.classList.toggle("hidden", shift !== "post");
}

function openWorkspace(settlement = null) {
  $("settlementWorkspace")?.classList.remove("hidden");
  state.editingId = settlement?.id || null;
  state.attachments = Array.isArray(settlement?.payload?.attachments) ? settlement.payload.attachments : [];
  $("businessDate").value = settlement?.businessDate || settlement?.payload?.businessDate || today();
  $("preSafeAmount").value = num(settlement?.payload?.preSafeAmount);
  $("cashAmount").value = num(settlement?.payload?.cashAmount);
  $("safeAmount").value = num(settlement?.payload?.safeAmount);
  $("bankTransferAmount").value = num(settlement?.payload?.bankTransferAmount);
  $("prizePayoutAmount").value = num(settlement?.payload?.prizePayoutAmount);
  $("handover").value = settlement?.payload?.handover || "";
  $("memo").value = settlement?.payload?.memo || "";
  renderRows(settlement?.payload?.lotteryItems || []);
  renderAttachments();
  setShift(settlement?.payload?.workflow?.preShift === "saved_or_entered" && settlement?.status === "draft" ? "post" : "pre");
  $("settlementWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeWorkspace() {
  $("settlementWorkspace")?.classList.add("hidden");
  state.editingId = null;
  state.attachments = [];
}

function productOptions(selected = "스피또1000") {
  const product = LOTTERY_PRODUCTS.includes(String(selected)) ? String(selected) : LOTTERY_PRODUCTS[1];
  return LOTTERY_PRODUCTS.map((item) => `<option value="${esc(item)}" ${item === product ? "selected" : ""}>${esc(item)}</option>`).join("");
}

function inventoryRow(item = {}) {
  const id = `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const original = num(item.originalStock);
  const pre = num(item.preWorkReturn);
  const restock = num(item.restock);
  const onDuty = num(item.onDutyReturn);
  const ending = num(item.endingStock);
  const adjusted = Math.max(0, original - pre);
  const available = Math.max(0, adjusted + restock - onDuty);
  const sold = Math.max(0, available - ending);
  return `<div class="inventory-row" data-row-id="${id}">
    <label><span class="sub-label">품목</span><select data-field="product">${productOptions(item.product)}</select></label>
    <label><span class="sub-label">회차</span><input data-field="draw" value="${esc(item.draw || "")}" placeholder="예: 109회"></label>
    <label><span class="sub-label">원재고</span><input data-field="originalStock" type="number" min="0" step="1" value="${original}"></label>
    <label><span class="sub-label">전 반품</span><input data-field="preWorkReturn" type="number" min="0" step="1" value="${pre}"></label>
    <label><span class="sub-label">입고</span><input data-field="restock" type="number" min="0" step="1" value="${restock}"></label>
    <label><span class="sub-label">중 반품</span><input data-field="onDutyReturn" type="number" min="0" step="1" value="${onDuty}"></label>
    <label><span class="sub-label">마감</span><input data-field="endingStock" type="number" min="0" step="1" value="${ending}"></label>
    <div class="computed" data-computed><span class="sub-label">판매 수량</span>${sold}장</div>
    <button class="button danger small row-wide" data-remove-row type="button">삭제</button>
  </div>`;
}

function renderRows(items = []) {
  const rows = $("stockRows");
  if (!rows) return;
  rows.innerHTML = (items.length ? items : [{}]).map(inventoryRow).join("");
  bindRows();
  updateComputed();
}

function bindRows() {
  document.querySelectorAll("[data-remove-row]").forEach((button) => button.addEventListener("click", () => {
    const rows = document.querySelectorAll("[data-row-id]");
    if (rows.length <= 1) { setMessage("formMsg", "최소 한 개의 복권 행은 남겨 주세요.", "error"); return; }
    button.closest("[data-row-id]")?.remove();
  }));
  document.querySelectorAll("[data-row-id] input, [data-row-id] select").forEach((input) => input.addEventListener("input", updateComputed));
}

function readRows({ requireEnding = false } = {}) {
  const rows = [];
  const keys = new Set();
  document.querySelectorAll("[data-row-id]").forEach((card) => {
    const item = {};
    card.querySelectorAll("[data-field]").forEach((field) => { item[field.dataset.field] = field.value; });
    item.product = String(item.product || "").trim();
    item.draw = String(item.draw || "").trim();
    const quantities = ["originalStock", "preWorkReturn", "restock", "onDutyReturn", "endingStock"].map((field) => num(item[field]));
    const hasInput = item.draw || quantities.some((value) => value > 0);
    if (!hasInput) return;
    if (!LOTTERY_PRODUCTS.includes(item.product)) throw new Error("인쇄복권 품목을 선택해 주세요.");
    if (!item.draw) throw new Error("품목의 회차를 입력해 주세요.");
    const key = rowKey(item);
    if (keys.has(key)) throw new Error("같은 품목과 회차를 중복 등록할 수 없습니다.");
    keys.add(key);
    const original = num(item.originalStock), pre = num(item.preWorkReturn), restock = num(item.restock), onDuty = num(item.onDutyReturn), ending = num(item.endingStock);
    const adjusted = original - pre;
    const available = adjusted + restock - onDuty;
    if (pre > original) throw new Error(`${item.product} / ${item.draw}: 근무 전 반품은 원재고보다 많을 수 없습니다.`);
    if (onDuty > adjusted + restock) throw new Error(`${item.product} / ${item.draw}: 근무 중 반품은 판매가능 재고를 초과할 수 없습니다.`);
    if (requireEnding && ending > available) throw new Error(`${item.product} / ${item.draw}: 마감 재고는 판매가능 재고보다 많을 수 없습니다.`);
    rows.push({ product: item.product, draw: item.draw, originalStock: original, preWorkReturn: pre, adjustedStock: Math.max(0, adjusted), restock, onDutyReturn: onDuty, availableStock: Math.max(0, available), endingStock: ending, soldQuantity: Math.max(0, available - ending) });
  });
  if (requireEnding && !rows.length) throw new Error("인쇄복권 품목을 한 개 이상 입력해 주세요.");
  return rows;
}

function updateComputed() {
  document.querySelectorAll("[data-row-id]").forEach((card) => {
    const get = (field) => num(card.querySelector(`[data-field="${field}"]`)?.value);
    const original = get("originalStock"), pre = get("preWorkReturn"), restock = get("restock"), onDuty = get("onDutyReturn"), ending = get("endingStock");
    const available = Math.max(0, original - pre + restock - onDuty);
    const sold = Math.max(0, available - ending);
    const computed = card.querySelector("[data-computed]");
    if (computed) computed.innerHTML = `<span class="sub-label">판매 수량</span>${sold.toLocaleString("ko-KR")}장`;
  });
}

function renderAttachments() {
  const root = $("photoPreview");
  if (!root) return;
  root.innerHTML = state.attachments.map((item, index) => `<img src="${esc(item.dataUrl)}" alt="증빙 사진 ${index + 1}" data-photo-src="${esc(item.dataUrl)}">`).join("");
  root.querySelectorAll("[data-photo-src]").forEach((image) => image.addEventListener("click", () => openPhoto(image.dataset.photoSrc)));
}

async function compressPhoto(file) {
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  const image = new Image();
  image.src = dataUrl;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  const scale = Math.min(1, 1500 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return { name: file.name.slice(0, 255), dataUrl: canvas.toDataURL("image/jpeg", .78) };
}

async function savePreShift() {
  try {
    const lotteryItems = readRows();
    const payload = buildPayload({ status: "draft", lotteryItems, workflow: { preShift: "saved_or_entered", postShift: "not_started" } });
    await api("/v1/web/settlements", { method: "POST", body: JSON.stringify({ payload }) });
    state.editingId = payload.id;
    setMessage("formMsg", "근무 전 정산이 저장되었습니다. 근무 후 입력을 이어서 진행할 수 있습니다.", "success");
    await loadHome();
  } catch (error) { setMessage("formMsg", error.message, "error"); }
}

function buildPayload({ status, lotteryItems, workflow }) {
  const id = state.editingId || `web-${state.user.staffId}-${Date.now()}`;
  return { id, businessDate: $("businessDate").value || today(), createdBy: { id: state.user.staffId, name: state.user.staffName || state.user.username, role: state.user.role }, status, updatedAt: Date.now(), preSafeAmount: num($("preSafeAmount").value), cashAmount: num($("cashAmount").value), safeAmount: num($("safeAmount").value), bankTransferAmount: num($("bankTransferAmount").value), prizePayoutAmount: num($("prizePayoutAmount").value), handover: $("handover").value.trim(), memo: $("memo").value.trim(), workflow, lotteryItems, attachments: state.attachments };
}

async function submitSettlement() {
  try {
    const lotteryItems = readRows({ requireEnding: true });
    const payload = buildPayload({ status: "submitted", lotteryItems, workflow: { preShift: "saved_or_entered", postShift: "submitted" } });
    await api("/v1/web/settlements", { method: "POST", body: JSON.stringify({ payload }) });
    setMessage("formMsg", "근무 후 정산이 저장되고 관리자 승인 요청으로 전환되었습니다.", "success");
    closeWorkspace();
    await loadHome();
    setPage("history");
  } catch (error) { setMessage("formMsg", error.message, "error"); }
}

async function loadCarryover() {
  try {
    const data = await api("/v1/web/settlements?limit=500");
    const latest = new Map();
    (data.settlements || []).filter((item) => item.status === "manager_approved").forEach((settlement) => {
      (settlement.payload?.lotteryItems || []).forEach((item) => {
        const key = rowKey(item), previous = latest.get(key);
        if (!previous || Number(settlement.updatedAt) > Number(previous.updatedAt)) latest.set(key, { updatedAt: settlement.updatedAt, item });
      });
    });
    const carry = [...latest.values()].map(({ item }) => ({ product: item.product, draw: item.draw, originalStock: num(item.endingStock), preWorkReturn: 0, restock: 0, onDutyReturn: 0, endingStock: 0 }));
    renderRows(carry);
    setMessage("formMsg", carry.length ? "승인된 마감 재고를 근무 전 원재고로 불러왔습니다." : "불러올 승인 완료 재고가 없습니다.", carry.length ? "success" : "muted");
  } catch (error) { setMessage("formMsg", error.message, "error"); }
}

async function loadHome() {
  if (!state.user) return;
  try {
    const data = await api("/v1/web/settlements?limit=100");
    state.settlements = data.settlements || [];
    const mine = state.user.role === "admin" ? state.settlements : state.settlements.filter((item) => item.author?.id === state.user.staffId);
    const latest = mine[0];
    if (state.user.role === "admin") {
      $("homeGreeting").textContent = "관리자 업무를 확인하세요.";
      $("homeDashboardMsg").textContent = "승인 대기 정산과 직원 상태를 관리합니다.";
      $("homeHeroActions").innerHTML = `<button class="button" data-home-page="manage">정산 승인 보기</button><button class="button secondary" data-home-page="history">전체 내역 보기</button>`;
      const submitted = state.settlements.filter((item) => item.status === "submitted").length;
      const approved = state.settlements.filter((item) => item.status === "manager_approved").length;
      const drafts = state.settlements.filter((item) => item.status === "draft").length;
      $("adminMetrics").innerHTML = `<div class="metric"><span>승인 대기</span><strong>${submitted}</strong></div><div class="metric"><span>승인 완료</span><strong>${approved}</strong></div><div class="metric"><span>작성 중</span><strong>${drafts}</strong></div>`;
    } else {
      const draft = mine.find((item) => item.status === "draft");
      const candidate = draft || latest;
      const status = candidate?.status || "draft";
      $("homeGreeting").textContent = draft ? "작성 중인 정산을 이어가세요." : latest ? "오늘의 정산 상태를 확인하세요." : "오늘의 정산 업무를 시작하세요.";
      $("homeDashboardMsg").textContent = draft ? "근무 전 정산이 저장되어 있습니다. 근무 후 입력을 이어갈 수 있습니다." : latest ? `최근 정산은 ${statusLabel(status)} 상태입니다.` : "근무 전 금고와 복권 재고부터 입력합니다.";
      $("homeHeroActions").innerHTML = draft ? `<button class="button" data-resume-id="${esc(draft.id)}">정산 이어서 입력</button>` : `<button class="button" data-start-settlement>근무 전 정산 시작</button>`;
      $("todayStatus").className = `status ${statusClass(status)}`;
      $("todayStatus").textContent = statusLabel(status);
      $("employeeTaskContent").innerHTML = candidate ? `<p style="margin:0;line-height:1.7">${esc(candidate.businessDate)} 정산 · ${money(candidate.payload?.cashAmount)}<br>마지막 저장 ${dateTime(candidate.updatedAt)}</p>` : `<p style="margin:0;line-height:1.7">아직 저장된 정산이 없습니다.<br>근무 전 정산을 시작해 주세요.</p>`;
      $("employeeQuickActions").innerHTML = `<button class="quick" data-home-page="history"><span class="quick-icon">▤</span><span><strong>정산 내역</strong><small>내가 저장한 정산과 승인 상태</small></span></button><button class="quick" data-home-page="inventory"><span class="quick-icon">▥</span><span><strong>복권 재고</strong><small>승인된 최신 재고</small></span></button>`;
    }
    bindHomeActions();
  } catch (error) { $("homeDashboardMsg").textContent = error.message; }
}

function bindHomeActions() {
  document.querySelectorAll("[data-home-page]").forEach((button) => button.onclick = () => setPage(button.dataset.homePage));
  document.querySelectorAll("[data-start-settlement]").forEach((button) => button.onclick = () => openWorkspace());
  document.querySelectorAll("[data-resume-id]").forEach((button) => button.onclick = () => { const settlement = state.settlements.find((item) => item.id === button.dataset.resumeId); if (settlement) openWorkspace(settlement); });
}

function statusClass(status) { return status === "manager_approved" ? "approved" : status === "submitted" ? "submitted" : status === "rejected" ? "rejected" : "draft"; }
function statusLabel(status) { return ({ draft: "작성 중", submitted: "승인 대기", manager_approved: "승인 완료", rejected: "반려" })[status] || status; }

function inventorySummary(items = []) { return items.map((item) => `${esc(item.product)} / ${esc(item.draw)} · 판매 ${num(item.soldQuantity).toLocaleString("ko-KR")}장 · 마감 ${num(item.endingStock).toLocaleString("ko-KR")}장`).join("<br>"); }

async function loadHistory() {
  const root = $("historyList"); if (!root) return;
  root.innerHTML = `<div class="empty">불러오는 중입니다.</div>`;
  try {
    const data = await api("/v1/web/settlements?limit=100"); state.settlements = data.settlements || [];
    root.innerHTML = state.settlements.length ? state.settlements.map((item) => `<article class="list-card"><div class="row"><div><h4>${esc(item.businessDate)} · ${esc(item.author?.name || "직원")} </h4><p>${dateTime(item.updatedAt)} · 현금 ${money(item.payload?.cashAmount)}</p></div><span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></div><div class="summary">${inventorySummary(item.payload?.lotteryItems || []) || "인쇄복권 재고 입력 없음"}</div><div class="form-actions"><button class="button ghost small" data-detail-id="${esc(item.id)}" type="button">정산 상세</button>${state.user?.role === "admin" && item.status === "submitted" ? `<button class="button small" data-approve-id="${esc(item.id)}" type="button">승인</button><button class="button danger small" data-reject-id="${esc(item.id)}" type="button">반려</button>` : ""}</div></article>`).join("") : `<div class="empty">저장된 정산이 없습니다.</div>`;
    bindSettlementActions(root);
  } catch (error) { root.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

function bindSettlementActions(root) {
  root.querySelectorAll("[data-detail-id]").forEach((button) => button.onclick = () => showDetail(state.settlements.find((item) => item.id === button.dataset.detailId)));
  root.querySelectorAll("[data-approve-id]").forEach((button) => button.onclick = () => transition(button.dataset.approveId, "approve"));
  root.querySelectorAll("[data-reject-id]").forEach((button) => button.onclick = () => transition(button.dataset.rejectId, "reject"));
}

async function loadInventory() {
  const root = $("inventoryList"); if (!root) return;
  root.innerHTML = `<div class="empty">승인된 최신 재고를 계산 중입니다.</div>`;
  try {
    const data = await api("/v1/web/settlements?limit=500"), latest = new Map();
    (data.settlements || []).filter((item) => item.status === "manager_approved").forEach((settlement) => (settlement.payload?.lotteryItems || []).forEach((item) => { const key = rowKey(item), old = latest.get(key); if (!old || Number(settlement.updatedAt) > Number(old.updatedAt)) latest.set(key, { updatedAt: settlement.updatedAt, item }); }));
    const items = [...latest.values()].sort((a, b) => `${a.item.product}${a.item.draw}`.localeCompare(`${b.item.product}${b.item.draw}`, "ko"));
    root.innerHTML = items.length ? items.map(({ item, updatedAt }) => `<article class="list-card"><div class="row"><h4>${esc(item.product)} · ${esc(item.draw)}</h4><span class="status approved">승인 반영</span></div><div class="summary">반품 반영 재고 <strong>${num(item.adjustedStock)}장</strong> · 입고 ${num(item.restock)}장 · 근무 중 반품 ${num(item.onDutyReturn)}장<br>판매가능 <strong>${num(item.availableStock)}장</strong> · 마감 ${num(item.endingStock)}장 · 판매 ${num(item.soldQuantity)}장<br><span class="muted">최종 승인 반영 ${dateTime(updatedAt)}</span></div></article>`).join("") : `<div class="empty">승인 완료된 복권 재고가 없습니다.</div>`;
  } catch (error) { root.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

async function loadApproval() {
  if (state.user?.role !== "admin") return;
  const root = $("approvalList"); if (!root) return;
  root.innerHTML = `<div class="empty">승인 대기 정산을 불러오는 중입니다.</div>`;
  try {
    const data = await api("/v1/web/settlements?status=submitted&limit=100"), items = data.settlements || [];
    root.innerHTML = items.length ? items.map((item) => `<article class="list-card"><div class="row"><div><h4>${esc(item.author?.name || "직원")} · ${esc(item.businessDate)}</h4><p>${dateTime(item.updatedAt)} · 현금 ${money(item.payload?.cashAmount)}</p></div><span class="status submitted">승인 대기</span></div><div class="summary">${inventorySummary(item.payload?.lotteryItems || []) || "복권 입력 없음"}</div><div class="form-actions"><button class="button ghost small" data-detail-id="${esc(item.id)}" type="button">상세·증빙 검토</button><button class="button small" data-approve-id="${esc(item.id)}" type="button">승인 반영</button><button class="button danger small" data-reject-id="${esc(item.id)}" type="button">반려</button></div></article>`).join("") : `<div class="empty">현재 승인 대기 정산이 없습니다.</div>`;
    bindSettlementActions(root);
  } catch (error) { root.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

async function transition(id, action) {
  if (action === "reject" && !window.confirm("이 정산을 반려하시겠습니까?")) return;
  try { await api(`/v1/web/settlements/${encodeURIComponent(id)}/${action}`, { method: "POST" }); await loadHome(); await loadHistory(); await loadApproval(); await loadInventory(); } catch (error) { window.alert(error.message); }
}

function showDetail(settlement) {
  if (!settlement) return;
  const payload = settlement.payload || {};
  const items = payload.lotteryItems || [];
  $("detailContent").innerHTML = `<div class="detail-grid"><div class="detail-box"><h4>기본 정보</h4><p>영업일: ${esc(settlement.businessDate)}<br>작성자: ${esc(settlement.author?.name || "-")}<br>상태: <b>${statusLabel(settlement.status)}</b><br>수정: ${dateTime(settlement.updatedAt)}</p></div><div class="detail-box"><h4>금액</h4><p>근무 전 금고: ${money(payload.preSafeAmount)}<br>현금 등록액: ${money(payload.cashAmount)}<br>근무 후 금고: ${money(payload.safeAmount)}<br>은행 이체: ${money(payload.bankTransferAmount)}<br>당첨금 지급: ${money(payload.prizePayoutAmount)}</p></div></div><div class="detail-box" style="margin-top:12px"><h4>인쇄복권 반품·재고·판매</h4><div class="table-like"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:#647589"><th style="padding:7px 4px">품목/회차</th><th>전 반품</th><th>입고</th><th>중 반품</th><th>마감</th><th>판매</th></tr></thead><tbody>${items.map((item) => `<tr style="border-top:1px solid #edf1f3"><td style="padding:8px 4px">${esc(item.product)} / ${esc(item.draw)}</td><td>${num(item.preWorkReturn)}장</td><td>${num(item.restock)}장</td><td>${num(item.onDutyReturn)}장</td><td>${num(item.endingStock)}장</td><td><b>${num(item.soldQuantity)}장</b></td></tr>`).join("") || `<tr><td colspan="6" style="padding:10px 4px;color:#647589">입력된 품목이 없습니다.</td></tr>`}</tbody></table></div></div>${payload.handover || payload.memo ? `<div class="detail-box" style="margin-top:12px"><h4>인수인계·메모</h4><p>${esc(payload.handover || "")}<br>${esc(payload.memo || "")}</p></div>` : ""}${Array.isArray(payload.attachments) && payload.attachments.length ? `<div class="detail-box" style="margin-top:12px"><h4>사진 증빙 ${payload.attachments.length}장</h4><div class="photos">${payload.attachments.map((photo) => `<img src="${esc(photo.dataUrl)}" alt="증빙 사진" data-photo-src="${esc(photo.dataUrl)}">`).join("")}</div></div>` : ""}${Array.isArray(payload.approvalEvents) && payload.approvalEvents.length ? `<div class="detail-box" style="margin-top:12px"><h4>승인 이력</h4><p>${payload.approvalEvents.map((event) => `${esc(statusLabel(event.status))} · ${esc(event.actor?.name || "관리자")} · ${dateTime(event.createdAt)}`).join("<br>")}</p></div>` : ""}`;
  $("detailModal").classList.remove("hidden");
  $("detailContent").querySelectorAll("[data-photo-src]").forEach((image) => image.addEventListener("click", () => openPhoto(image.dataset.photoSrc)));
}

async function loadStaff() {
  if (state.user?.role !== "admin") return;
  const root = $("employeeList"); if (!root) return;
  try {
    const data = await api("/v1/web/admin/staff"), staff = data.staff || [];
    root.innerHTML = staff.length ? staff.map((item) => `<div class="staff-card"><div class="staff-meta"><strong>${esc(item.name)} ${item.role === "admin" ? "· 관리자" : "· 직원"}</strong><span>ID: ${esc(item.id)} · 웹 계정: ${esc(item.webUsername || "미연결")} · ${item.webActive ? "사용 중" : "사용 중지"}</span></div><div class="form-actions" style="margin:0">${item.webUsername ? `<button class="button secondary small" data-toggle-staff="${esc(item.id)}" data-next-active="${!item.webActive}" type="button">${item.webActive ? "웹 중지" : "웹 허용"}</button>` : ""}${item.role !== "admin" ? `<button class="button danger small" data-delete-staff="${esc(item.id)}" type="button">삭제</button>` : ""}</div></div>`).join("") : `<div class="empty">등록된 직원이 없습니다.</div>`;
    root.querySelectorAll("[data-toggle-staff]").forEach((button) => button.onclick = async () => { try { await api(`/v1/web/admin/staff/${encodeURIComponent(button.dataset.toggleStaff)}/web-account`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.nextActive === "true" }) }); await loadStaff(); } catch (error) { window.alert(error.message); } });
    root.querySelectorAll("[data-delete-staff]").forEach((button) => button.onclick = async () => { if (!window.confirm("직원과 연결된 웹 세션을 삭제하시겠습니까?")) return; try { await api(`/v1/web/admin/staff/${encodeURIComponent(button.dataset.deleteStaff)}`, { method: "DELETE" }); setMessage("staffMsg", "직원이 삭제되고 연결된 웹 세션이 비활성화되었습니다.", "success"); await loadStaff(); } catch (error) { setMessage("staffMsg", error.message, "error"); } });
  } catch (error) { root.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

async function loadDevices() {
  if (state.user?.role !== "admin") return;
  const root = $("deviceList"); if (!root) return;
  try { const data = await api("/v1/web/admin/devices"), devices = data.devices || []; root.innerHTML = devices.length ? devices.map((item) => `<div class="device-card"><div class="device-meta"><strong>${esc(item.staffName || item.username || item.staffId)}</strong><span>${esc(item.username)} · 최근 사용 ${dateTime(item.lastSeenAt)}</span></div><button class="button danger small" data-revoke-device="${esc(item.id)}" type="button">등록 해제</button></div>`).join("") : `<div class="empty">현재 등록된 웹 기기가 없습니다.</div>`; root.querySelectorAll("[data-revoke-device]").forEach((button) => button.onclick = async () => { try { await api(`/v1/web/admin/devices/${encodeURIComponent(button.dataset.revokeDevice)}`, { method: "POST" }); await loadDevices(); } catch (error) { window.alert(error.message); } }); } catch (error) { root.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

function openPhoto(src) { $("photoModalImg").src = src; state.photoScale = 1; $("photoModalImg").style.transform = "scale(1)"; $("photoModal").classList.remove("hidden"); }
function closePhoto() { $("photoModal").classList.add("hidden"); }

async function login(event) {
  event.preventDefault();
  try { const data = await api("/v1/web/auth/login", { method: "POST", body: JSON.stringify({ username: $("username").value.trim(), password: $("password").value }) }); state.token = data.token; state.user = data.user; localStorage.setItem("webToken", state.token); showApp(); } catch (error) { setMessage("loginMsg", error.message, "error"); }
}

async function restore() {
  if (!state.token) return showLogin();
  try { const data = await api("/v1/web/auth/me"); state.user = data.user; showApp(); } catch { localStorage.removeItem("webToken"); state.token = ""; showLogin(); }
}

async function logout() { try { await api("/v1/web/auth/logout", { method: "POST" }); } catch {} localStorage.removeItem("webToken"); state.token = ""; state.user = null; showLogin(); }

$("loginForm")?.addEventListener("submit", login);
$("logoutBtn")?.addEventListener("click", logout);
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.view)));
document.querySelectorAll("[data-shift]").forEach((button) => button.addEventListener("click", () => setShift(button.dataset.shift)));
document.querySelectorAll("[data-admin-panel]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-admin-panel]").forEach((item) => item.classList.toggle("active", item === button)); document.querySelectorAll(".admin-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${button.dataset.adminPanel}Panel`)); if (button.dataset.adminPanel === "approval") loadApproval(); if (button.dataset.adminPanel === "staff") loadStaff(); if (button.dataset.adminPanel === "devices") loadDevices(); }));
$("addStockBtn")?.addEventListener("click", () => { $("stockRows").insertAdjacentHTML("beforeend", inventoryRow()); bindRows(); });
$("savePreShiftBtn")?.addEventListener("click", savePreShift);
$("submitSettlementBtn")?.addEventListener("click", submitSettlement);
$("loadCarryoverBtn")?.addEventListener("click", loadCarryover);
$("closeWorkspaceBtn")?.addEventListener("click", closeWorkspace);
$("refreshBtn")?.addEventListener("click", loadHistory);
$("refreshInventoryBtn")?.addEventListener("click", loadInventory);
$("refreshApprovalBtn")?.addEventListener("click", loadApproval);
$("refreshDevicesBtn")?.addEventListener("click", loadDevices);
$("closeDetailBtn")?.addEventListener("click", () => $("detailModal").classList.add("hidden"));
$("detailModal")?.addEventListener("click", (event) => { if (event.target === $("detailModal")) $("detailModal").classList.add("hidden"); });
$("photoClose")?.addEventListener("click", closePhoto);
$("photoModal")?.addEventListener("click", (event) => { if (event.target === $("photoModal")) closePhoto(); });
$("photoZoomIn")?.addEventListener("click", () => { state.photoScale = Math.min(4, state.photoScale + .25); $("photoModalImg").style.transform = `scale(${state.photoScale})`; });
$("photoZoomOut")?.addEventListener("click", () => { state.photoScale = Math.max(.5, state.photoScale - .25); $("photoModalImg").style.transform = `scale(${state.photoScale})`; });
$("photos")?.addEventListener("change", async (event) => { try { const files = [...event.target.files]; if (state.attachments.length + files.length > 8) throw new Error("사진 증빙은 최대 8장까지 첨부할 수 있습니다."); state.attachments = state.attachments.concat(await Promise.all(files.map(compressPhoto))); renderAttachments(); event.target.value = ""; } catch (error) { setMessage("formMsg", error.message, "error"); } });
$("staffForm")?.addEventListener("submit", async (event) => { event.preventDefault(); try { const name = $("staffName").value.trim(); const data = await api("/v1/web/admin/staff", { method: "POST", body: JSON.stringify({ name }) }); $("staffName").value = ""; setMessage("staffMsg", `${data.name || name} 직원을 추가했습니다.`, "success"); await loadStaff(); } catch (error) { setMessage("staffMsg", error.message, "error"); } });
$("webUserForm")?.addEventListener("submit", async (event) => { event.preventDefault(); try { const data = await api("/v1/web/admin/users", { method: "POST", body: JSON.stringify({ staffId: $("webStaffId").value.trim(), username: $("webNewUsername").value.trim(), password: $("webNewPassword").value, role: "employee" }) }); $("webNewPassword").value = ""; setMessage("webUserMsg", `${data.username} 웹 계정을 연결했습니다.`, "success"); await loadStaff(); } catch (error) { setMessage("webUserMsg", error.message, "error"); } });

renderRows([]);
restore();
