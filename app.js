import {
  calculateOverallSummary,
  DEFAULT_ASSETS,
  STORAGE_KEY,
  asNumber,
  calculateMonthlyPlan,
  getLastCarry,
  recomputeHoldingsChain,
  recomputeCashflowChain,
  validateInputs
} from "./calc.js";

const monthLabelEl = document.getElementById("monthLabel");
const monthlyBudgetKrwEl = document.getElementById("monthlyBudgetKrw");
const fxRateEl = document.getElementById("fxRate");
const carryInUsdEl = document.getElementById("carryInUsd");
const actualDividendUsdEl = document.getElementById("actualDividendUsd");
const assetRowsEl = document.getElementById("assetRows");
const saveMonthButton = document.getElementById("saveMonthButton");
const refreshPricesButton = document.getElementById("refreshPricesButton");
const deleteMonthButton = document.getElementById("deleteMonthButton");
const resetButton = document.getElementById("resetButton");
const formMessageEl = document.getElementById("formMessage");
const summaryCardsEl = document.getElementById("summaryCards");
const overallSummaryCardsEl = document.getElementById("overallSummaryCards");
const overallHoldingsRowsEl = document.getElementById("overallHoldingsRows");
const trendChartEl = document.getElementById("trendChart");
const trendLegendEl = document.getElementById("trendLegend");
const trendCurrencySelectEl = document.getElementById("trendCurrencySelect");
const orderRowsEl = document.getElementById("orderRows");
const historyRowsEl = document.getElementById("historyRows");

const TREND_SERIES = [
  { key: "totalInvestedUsd", label: "실제 투자", color: "#0a7a5a" },
  { key: "netDividendReceivedUsd", label: "세후 배당", color: "#0ea5e9" },
  { key: "carryOutUsd", label: "다음달 이월", color: "#f97316" }
];

const TREND_CURRENCY_KEY = "etf_trend_currency_v1";

const fmtUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const fmtKrw = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0
});

const state = {
  assets: structuredClone(DEFAULT_ASSETS),
  records: [],
  preview: null,
  trendCurrency: "USD"
};

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function loadTrendCurrencyPreference() {
  const found = localStorage.getItem(TREND_CURRENCY_KEY);
  if (found === "USD" || found === "KRW") {
    state.trendCurrency = found;
  }
}

function saveTrendCurrencyPreference() {
  localStorage.setItem(TREND_CURRENCY_KEY, state.trendCurrency);
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  const withFallbackIds = records.map((record, idx) => ({
    ...record,
    id: record.id || `${record.monthLabel || "record"}-${idx}`
  }));

  return recomputeAllChains(withFallbackIds);
}

function recomputeAllChains(records) {
  return recomputeHoldingsChain(recomputeCashflowChain(records));
}

function getHoldingsBeforeMonth(records, targetMonth) {
  const sorted = records
    .slice()
    .sort((a, b) => String(a.monthLabel).localeCompare(String(b.monthLabel)));

  let previous = null;
  for (const record of sorted) {
    if (String(record.monthLabel) < String(targetMonth)) {
      previous = record;
      continue;
    }
    break;
  }

  if (!previous || !previous.holdingsAfter || typeof previous.holdingsAfter !== "object") {
    return {};
  }

  return previous.holdingsAfter;
}

function loadLegacyLocalRecords() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeRecords(parsed);
  } catch {
    return [];
  }
}

async function loadRecordsFromServer() {
  const response = await fetch("/api/records", {
    method: "GET",
    credentials: "same-origin"
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "서버에서 기록을 불러오지 못했습니다.");
  }

  state.records = normalizeRecords(payload.records);
}

async function saveRecordsToServer() {
  const response = await fetch("/api/records", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ records: state.records })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "서버에 기록 저장에 실패했습니다.");
  }
}

async function migrateLegacyLocalRecordsIfNeeded() {
  if (state.records.length > 0) {
    return;
  }

  const legacyRecords = loadLegacyLocalRecords();
  if (!legacyRecords.length) {
    return;
  }

  state.records = legacyRecords;
  await saveRecordsToServer();
  localStorage.removeItem(STORAGE_KEY);
}

function setMessage(text, isError = false) {
  formMessageEl.textContent = text;
  formMessageEl.className = isError ? "message error" : "message";
}

function setDefaultMonth() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  monthLabelEl.value = `${now.getFullYear()}-${month}`;
}

function renderAssetRows() {
  assetRowsEl.innerHTML = "";

  for (const asset of state.assets) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="종목">${asset.symbol}</td>
      <td data-label="비중 (%)"><input data-symbol="${asset.symbol}" data-field="weightPct" type="number" min="0" step="0.01" value="${asset.weightPct}" /></td>
      <td data-label="현재가 (USD)"><input data-symbol="${asset.symbol}" data-field="priceUsd" type="number" min="0" step="0.01" value="${asset.priceUsd}" /></td>
    `;
    assetRowsEl.appendChild(tr);
  }
}

function applyAssetInputUpdates() {
  const inputs = assetRowsEl.querySelectorAll("input");

  for (const input of inputs) {
    const symbol = input.dataset.symbol;
    const field = input.dataset.field;
    const asset = state.assets.find((a) => a.symbol === symbol);
    if (!asset) {
      continue;
    }
    asset[field] = asNumber(input.value, asset[field]);
  }
}

async function refreshAssetPrices() {
  applyAssetInputUpdates();

  const symbols = state.assets.map((asset) => String(asset.symbol || "").toUpperCase()).filter(Boolean);
  if (!symbols.length) {
    setMessage("조회할 종목이 없습니다.", true);
    return;
  }

  setMessage("현재가 조회 중...");

  try {
    const query = encodeURIComponent(symbols.join(","));
    const response = await fetch(`/api/quotes?symbols=${query}`, {
      method: "GET",
      credentials: "same-origin"
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "현재가 조회에 실패했습니다.");
    }

    const prices = payload.prices && typeof payload.prices === "object" ? payload.prices : {};
    let updatedCount = 0;

    state.assets = state.assets.map((asset) => {
      const symbol = String(asset.symbol || "").toUpperCase();
      const nextPrice = asNumber(prices[symbol]);
      if (nextPrice > 0) {
        updatedCount += 1;
        return { ...asset, priceUsd: round2(nextPrice) };
      }
      return asset;
    });

    renderAssetRows();
    renderOverallSummary(state.records);

    if (state.preview) {
      renderSummaryCards(state.preview);
      renderOrderRows(state.preview);
    }

    if (updatedCount === 0) {
      setMessage("조회된 현재가가 없어 기존 가격을 유지했습니다.", true);
      return;
    }

    const refreshedAt = payload.asOf ? ` (${payload.asOf})` : "";
    setMessage(`현재가 ${updatedCount}개 종목 업데이트 완료${refreshedAt}`);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "현재가 조회 중 오류가 발생했습니다.", true);
  }
}

function renderSummaryCards(plan) {
  if (!plan) {
    summaryCardsEl.innerHTML = "";
    return;
  }

  const netDividendReceivedUsd = asNumber(
    plan.netDividendReceivedUsd,
    asNumber(plan.actualDividendUsd)
  );

  const cards = [
    { label: "총 투자 가능", value: fmtUsd.format(plan.investableUsd) },
    {
      label: "실제 투자",
      value: `${fmtUsd.format(plan.totalInvestedUsd)} / ${fmtKrw.format(
        plan.totalInvestedUsd * plan.fxRate
      )}`
    },
    { label: "남은 달러", value: fmtUsd.format(plan.leftoverUsd) },
    {
      label: "이번 달 세후 배당 입금",
      value: fmtUsd.format(netDividendReceivedUsd)
    },
    {
      label: "다음 달 이월금",
      value: `${fmtUsd.format(plan.carryOutUsd)} ` +
        `<span class="badge">남은 달러 + 실제 배당</span>`
    }
  ];

  summaryCardsEl.innerHTML = cards
    .map(
      (card) =>
        `<div class="card"><span class="k">${card.label}</span><span class="v">${card.value}</span></div>`
    )
    .join("");
}

function renderOrderRows(plan) {
  if (!plan || !plan.buys.length) {
    orderRowsEl.innerHTML =
      '<tr><td colspan="4" class="empty">아직 계산된 데이터가 없습니다.</td></tr>';
    return;
  }

  orderRowsEl.innerHTML = plan.buys
    .map(
      (buy) => `
        <tr>
          <td data-label="종목">${buy.symbol}</td>
          <td data-label="매수 수량(주)">${buy.sharesToBuy.toLocaleString()}</td>
          <td data-label="투자금(USD)">${fmtUsd.format(buy.investedUsd)}</td>
          <td data-label="누적 보유(주)">${buy.afterShares.toLocaleString()}</td>
        </tr>
      `
    )
    .join("");
}

function getRecordDividendUsd(record) {
  return asNumber(record.netDividendReceivedUsd, asNumber(record.actualDividendUsd));
}

function convertUsdByCurrency(usdValue, fxRate, currency) {
  if (currency === "KRW") {
    return asNumber(usdValue) * asNumber(fxRate);
  }
  return asNumber(usdValue);
}

function formatTrendValue(value, currency) {
  if (currency === "KRW") {
    return fmtKrw.format(value);
  }
  return fmtUsd.format(value);
}

function formatTrendAxisTick(value, currency) {
  if (currency === "KRW") {
    return Math.round(value).toLocaleString("ko-KR");
  }

  if (value >= 100) {
    return Math.round(value).toString();
  }
  return value.toFixed(1);
}

function renderTrendChart(records) {
  if (!trendChartEl || !trendLegendEl) {
    return;
  }

  const rect = trendChartEl.getBoundingClientRect();
  const fallbackHeight = window.matchMedia("(max-width: 640px)").matches ? 210 : 260;
  const width = Math.max(320, Math.round(rect.width || 860));
  const height = Math.max(180, Math.round(rect.height || fallbackHeight));
  trendChartEl.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const currency = state.trendCurrency;

  if (!records.length) {
    trendChartEl.innerHTML =
      `<rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />` +
      `<text x="${width / 2}" y="${height / 2 + 8}" text-anchor="middle" fill="#78909d" font-size="14">저장된 기록이 없어 추이 차트가 비어 있습니다.</text>`;
    trendLegendEl.innerHTML = "";
    return;
  }

  const sorted = records
    .slice()
    .sort((a, b) => String(a.monthLabel).localeCompare(String(b.monthLabel)));
  const labels = sorted.map((row) => row.monthLabel);

  const series = TREND_SERIES.map((meta) => {
    const values = sorted.map((row) => {
      const usdValue =
        meta.key === "netDividendReceivedUsd"
          ? getRecordDividendUsd(row)
          : asNumber(row[meta.key]);

      return convertUsdByCurrency(usdValue, row.fxRate, currency);
    });
    return { ...meta, values };
  });

  const axisUnitLabel = currency === "KRW" ? "KRW" : "USD";

  const allValues = series.flatMap((row) => row.values);
  const rawMax = Math.max(...allValues, 0);
  const maxValue = rawMax > 0 ? rawMax : 1;

  const pad = { top: 24, right: 20, bottom: 56, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xAt = (idx) => {
    if (labels.length === 1) {
      return pad.left + plotW / 2;
    }
    return pad.left + (plotW * idx) / (labels.length - 1);
  };
  const yAt = (value) => pad.top + (1 - value / maxValue) * plotH;

  const axis = [
    `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" stroke="#d7e2e8" />`,
    `<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" stroke="#d7e2e8" />`,
    `<text x="${pad.left}" y="${pad.top - 4}" text-anchor="start" fill="#607482" font-size="10">${axisUnitLabel}</text>`
  ];

  const grid = [];
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const ratio = i / ticks;
    const y = pad.top + plotH * ratio;
    const tickValue = maxValue * (1 - ratio);
    grid.push(
      `<line x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}" stroke="#edf3f6" />`
    );
    grid.push(
      `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#78909d" font-size="10">${formatTrendAxisTick(tickValue, currency)}</text>`
    );
  }

  const xLabels = labels
    .map((label, idx) => {
      const x = xAt(idx);
      return `<text x="${x}" y="${height - 16}" text-anchor="middle" fill="#607482" font-size="10">${label}</text>`;
    })
    .join("");

  const lines = series
    .map((row) => {
      const points = row.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
      const circles = row.values
        .map((v, i) => {
          const x = xAt(i);
          const y = yAt(v);
          return `<circle cx="${x}" cy="${y}" r="3" fill="${row.color}"><title>${row.label}: ${formatTrendValue(v, currency)}</title></circle>`;
        })
        .join("");

      return `<polyline points="${points}" fill="none" stroke="${row.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />${circles}`;
    })
    .join("");

  trendChartEl.innerHTML = `${grid.join("")}${axis.join("")}${lines}${xLabels}`;

  trendLegendEl.innerHTML = TREND_SERIES.map(
    (row) =>
      `<span class="legend-item"><span class="legend-dot" style="background:${row.color}"></span>${row.label}</span>`
  ).join("");
}

function handleTrendCurrencyChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.value !== "USD" && target.value !== "KRW") {
    return;
  }

  state.trendCurrency = target.value;
  saveTrendCurrencyPreference();
  renderOverallSummary(state.records);
}

function renderOverallSummary(records) {
  const overall = calculateOverallSummary(records, state.assets);

  const cards = [
    { label: "저장된 월 수", value: `${overall.monthCount}개월` },
    { label: "누적 원금(USD)", value: fmtUsd.format(overall.totalPrincipalUsd) },
    { label: "누적 월 투자금", value: fmtKrw.format(overall.totalBudgetKrw) },
    {
      label: "누적 월 투자금(USD 환산)",
      value: fmtUsd.format(overall.totalBudgetUsd)
    },
    { label: "누적 실제 투자", value: fmtUsd.format(overall.totalInvestedUsd) },
    { label: "누적 세후 배당 입금", value: fmtUsd.format(overall.totalDividendUsd) },
    { label: "현재 주식 평가금액", value: fmtUsd.format(overall.currentMarketValueUsd) },
    { label: "현재 이월금", value: fmtUsd.format(overall.currentCarryUsd) },
    { label: "현재 총자산", value: fmtUsd.format(overall.totalAccountValueUsd) },
    { label: "총수익(배당 포함)", value: fmtUsd.format(overall.totalProfitUsd) },
    { label: "총수익률", value: `${overall.totalReturnPct.toFixed(2)}%` },
    { label: "현재 누적 보유 주수", value: `${overall.currentTotalShares.toLocaleString()}주` }
  ];

  overallSummaryCardsEl.innerHTML = cards
    .map(
      (card) =>
        `<div class="card"><span class="k">${card.label}</span><span class="v">${card.value}</span></div>`
    )
    .join("");

  renderTrendChart(records);

  if (!overall.holdings.length) {
    overallHoldingsRowsEl.innerHTML =
      '<tr><td colspan="7" class="empty">저장된 기록이 없습니다.</td></tr>';
    return;
  }

  overallHoldingsRowsEl.innerHTML = overall.holdings
    .map(
      (holding) => `
        <tr>
          <td data-label="종목">${holding.symbol}</td>
          <td data-label="누적 매수(주)">${holding.totalBoughtShares.toLocaleString()}</td>
          <td data-label="현재 보유(주)">${holding.currentShares.toLocaleString()}</td>
          <td data-label="현재가(USD)">${fmtUsd.format(holding.currentPriceUsd)}</td>
          <td data-label="누적 투자금(USD)">${fmtUsd.format(holding.totalInvestedUsd)}</td>
          <td data-label="평균 매입단가(USD)">${fmtUsd.format(holding.averageCostUsd)}</td>
          <td data-label="평가금액(USD)">${fmtUsd.format(holding.marketValueUsd)}</td>
        </tr>
      `
    )
    .join("");
}

function renderHistory() {
  if (!state.records.length) {
    historyRowsEl.innerHTML =
      '<tr><td colspan="7" class="empty">저장된 기록이 없습니다.</td></tr>';
    return;
  }

  historyRowsEl.innerHTML = state.records
    .slice()
    .reverse()
    .map(
      (record) => `
        <tr>
          <td data-label="월">${record.monthLabel}</td>
          <td data-label="총 투자 가능(USD)">${fmtUsd.format(record.investableUsd)}</td>
          <td data-label="실제 투자(USD)">${fmtUsd.format(record.totalInvestedUsd)}</td>
          <td data-label="남은 달러(USD)">${fmtUsd.format(record.leftoverUsd)}</td>
          <td data-label="실제 배당(USD)">${fmtUsd.format(asNumber(record.netDividendReceivedUsd, asNumber(record.actualDividendUsd)))}</td>
          <td data-label="다음달 이월(USD)">${fmtUsd.format(record.carryOutUsd)}</td>
          <td data-label="배당 수정">
            <div class="history-edit">
              <input
                class="history-div-input"
                type="number"
                min="0"
                step="0.01"
                data-record-id="${record.id}"
                value="${asNumber(record.netDividendReceivedUsd, asNumber(record.actualDividendUsd))}"
              />
              <button
                type="button"
                class="mini-button ghost history-save-button"
                data-record-id="${record.id}"
              >
                저장
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

async function handleHistoryDividendSave(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest(".history-save-button");
  if (!button) {
    return;
  }

  const recordId = button.dataset.recordId;
  if (!recordId) {
    return;
  }

  const input = historyRowsEl.querySelector(`.history-div-input[data-record-id="${recordId}"]`);
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const nextDividend = asNumber(input.value);
  if (nextDividend < 0) {
    setMessage("세후 배당금은 음수가 될 수 없습니다.", true);
    return;
  }

  const found = state.records.find((record) => record.id === recordId);
  if (!found) {
    setMessage("대상 기록을 찾지 못했습니다.", true);
    return;
  }

  const previousRecords = structuredClone(state.records);

  found.netDividendReceivedUsd = nextDividend;
  found.actualDividendUsd = nextDividend;

  state.records = recomputeAllChains(state.records);

  try {
    await saveRecordsToServer();
  } catch (error) {
    state.records = previousRecords;
    const restored = state.records[state.records.length - 1] || null;
    state.preview = restored;
    renderSummaryCards(restored);
    renderOrderRows(restored);
    renderOverallSummary(state.records);
    renderHistory();
    syncCarryInputFromHistory();
    setMessage(error instanceof Error ? error.message : "서버 저장에 실패했습니다.", true);
    return;
  }

  const latest = state.records[state.records.length - 1] || null;
  state.preview = latest;
  renderSummaryCards(latest);
  renderOrderRows(latest);
  renderOverallSummary(state.records);
  renderHistory();
  syncCarryInputFromHistory();

  setMessage(`${found.monthLabel} 배당금이 ${fmtUsd.format(nextDividend)}로 저장되었습니다.`);
}

async function handleDeleteMonth() {
  const targetMonth = monthLabelEl.value;
  if (!targetMonth) {
    setMessage("삭제할 월을 먼저 선택해 주세요.", true);
    return;
  }

  const found = state.records.some((record) => record.monthLabel === targetMonth);
  if (!found) {
    setMessage(`${targetMonth} 기록이 없습니다.`, true);
    return;
  }

  const previousRecords = structuredClone(state.records);

  state.records = state.records.filter((record) => record.monthLabel !== targetMonth);
  state.records = recomputeAllChains(state.records);

  try {
    await saveRecordsToServer();
  } catch (error) {
    state.records = previousRecords;
    const restored = state.records[state.records.length - 1] || null;
    state.preview = restored;
    renderSummaryCards(restored);
    renderOrderRows(restored);
    renderOverallSummary(state.records);
    renderHistory();
    syncCarryInputFromHistory();
    setMessage(error instanceof Error ? error.message : "서버 저장에 실패했습니다.", true);
    return;
  }

  const latest = state.records[state.records.length - 1] || null;
  state.preview = latest;
  renderSummaryCards(latest);
  renderOrderRows(latest);
  renderOverallSummary(state.records);
  renderHistory();
  syncCarryInputFromHistory();

  setMessage(`${targetMonth} 기록을 삭제했습니다.`);
}

function collectFormData() {
  applyAssetInputUpdates();

  return {
    monthLabel: monthLabelEl.value,
    monthlyBudgetKrw: asNumber(monthlyBudgetKrwEl.value),
    fxRate: asNumber(fxRateEl.value),
    carryInUsd: asNumber(carryInUsdEl.value),
    actualDividendUsd: asNumber(actualDividendUsdEl.value),
    assets: state.assets
  };
}

function syncCarryInputFromHistory() {
  carryInUsdEl.value = String(getLastCarry(state.records));
}

async function handleSaveMonth() {
  const basePayload = collectFormData();
  const error = validateInputs(basePayload);

  if (!basePayload.monthLabel) {
    setMessage("월을 선택해 주세요.", true);
    return;
  }
  if (error) {
    setMessage(error, true);
    return;
  }

  const existingRecord = state.records.find((record) => record.monthLabel === basePayload.monthLabel);

  const payload = {
    ...basePayload,
    holdingsBefore: getHoldingsBeforeMonth(state.records, basePayload.monthLabel)
  };

  const plan = calculateMonthlyPlan(payload);
  if (existingRecord) {
    plan.id = existingRecord.id;
    plan.createdAt = existingRecord.createdAt || plan.createdAt;
  }

  const previousRecords = structuredClone(state.records);

  const nextRecords = existingRecord
    ? state.records.map((record) =>
        record.monthLabel === basePayload.monthLabel ? plan : record
      )
    : [...state.records, plan];

  state.records = recomputeAllChains(nextRecords);

  const savedPlan = state.records.find((record) => record.id === plan.id) || plan;
  state.preview = savedPlan;

  try {
    await saveRecordsToServer();
  } catch (error) {
    state.records = previousRecords;
    const restored = state.records[state.records.length - 1] || null;
    state.preview = restored;
    renderSummaryCards(restored);
    renderOrderRows(restored);
    renderOverallSummary(state.records);
    renderHistory();
    syncCarryInputFromHistory();
    setMessage(error instanceof Error ? error.message : "서버 저장에 실패했습니다.", true);
    return;
  }

  renderSummaryCards(savedPlan);
  renderOrderRows(savedPlan);
  renderOverallSummary(state.records);
  renderHistory();
  syncCarryInputFromHistory();

  const actionLabel = existingRecord ? "업데이트" : "저장";
  setMessage(`${plan.monthLabel} ${actionLabel} 완료: ${plan.buys.map((b) => `${b.symbol} ${b.sharesToBuy}주`).join(", ")}`);
}

async function handleReset() {
  const previousRecords = structuredClone(state.records);
  state.records = [];
  state.preview = null;

  try {
    await saveRecordsToServer();
  } catch (error) {
    state.records = previousRecords;
    const restored = state.records[state.records.length - 1] || null;
    state.preview = restored;
    renderSummaryCards(restored);
    renderOrderRows(restored);
    renderOverallSummary(state.records);
    renderHistory();
    syncCarryInputFromHistory();
    setMessage(error instanceof Error ? error.message : "서버 저장에 실패했습니다.", true);
    return;
  }

  renderSummaryCards(null);
  renderOrderRows(null);
  renderOverallSummary([]);
  renderHistory();
  syncCarryInputFromHistory();
  setMessage("전체 기록(모든 월)이 삭제되었습니다.");
}

async function boot() {
  loadTrendCurrencyPreference();
  await loadRecordsFromServer();
  await migrateLegacyLocalRecordsIfNeeded();
  renderAssetRows();
  setDefaultMonth();

  monthlyBudgetKrwEl.value = "1000000";
  fxRateEl.value = "1469.5";
  actualDividendUsdEl.value = "0";
  syncCarryInputFromHistory();

  if (trendCurrencySelectEl instanceof HTMLSelectElement) {
    trendCurrencySelectEl.value = state.trendCurrency;
  }

  if (state.records.length) {
    const last = state.records[state.records.length - 1];
    state.preview = last;
    renderSummaryCards(last);
    renderOrderRows(last);
  }

  renderOverallSummary(state.records);
  renderHistory();

  saveMonthButton.addEventListener("click", handleSaveMonth);
  if (refreshPricesButton instanceof HTMLButtonElement) {
    refreshPricesButton.addEventListener("click", refreshAssetPrices);
  }
  deleteMonthButton.addEventListener("click", handleDeleteMonth);
  resetButton.addEventListener("click", handleReset);
  historyRowsEl.addEventListener("click", handleHistoryDividendSave);
  if (trendCurrencySelectEl instanceof HTMLSelectElement) {
    trendCurrencySelectEl.addEventListener("change", handleTrendCurrencyChange);
  }
  window.addEventListener("resize", () => {
    renderOverallSummary(state.records);
  });
}

boot().catch((error) => {
  setMessage(error instanceof Error ? error.message : "초기화에 실패했습니다.", true);
});
