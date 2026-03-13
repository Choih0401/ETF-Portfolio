import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateMonthlyPlan,
  calculateOverallSummary,
  rebalanceAssetWeights,
  recomputeCashflowChain,
  recomputeHoldingsChain,
  validateInputs
} from "../calc.js";

test("validateInputs rejects incorrect weight sum", () => {
  const error = validateInputs({
    monthlyBudgetKrw: 1000000,
    fxRate: 1400,
    carryInUsd: 0,
    actualDividendUsd: 0,
    assets: [
      { symbol: "A", weightPct: 60, priceUsd: 10 },
      { symbol: "B", weightPct: 30, priceUsd: 20 }
    ]
  });

  assert.ok(error.includes("비중 합계"));
});

test("validateInputs rejects empty asset list", () => {
  const error = validateInputs({
    monthlyBudgetKrw: 1000000,
    fxRate: 1400,
    carryInUsd: 0,
    actualDividendUsd: 0,
    assets: []
  });

  assert.ok(error.includes("최소 1개"));
});

test("validateInputs rejects duplicate symbols", () => {
  const error = validateInputs({
    monthlyBudgetKrw: 1000000,
    fxRate: 1400,
    carryInUsd: 0,
    actualDividendUsd: 0,
    assets: [
      { symbol: "jepq", weightPct: 50, priceUsd: 10 },
      { symbol: "JEPQ", weightPct: 50, priceUsd: 20 }
    ]
  });

  assert.ok(error.includes("중복"));
});

test("rebalanceAssetWeights normalizes to exact 100 percent", () => {
  const result = rebalanceAssetWeights([
    { symbol: "A", weightPct: 10, priceUsd: 10 },
    { symbol: "B", weightPct: 10, priceUsd: 20 },
    { symbol: "C", weightPct: 10, priceUsd: 30 }
  ]);

  const sum = result.reduce((acc, item) => acc + item.weightPct, 0);
  assert.equal(sum, 100);
  assert.deepEqual(
    result.map((item) => item.weightPct),
    [33.34, 33.33, 33.33]
  );
});

test("calculateMonthlyPlan uses integer share allocation and carryout logic", () => {
  const result = calculateMonthlyPlan({
    monthLabel: "2026-03",
    monthlyBudgetKrw: 1000000,
    fxRate: 1469.5049,
    carryInUsd: 0,
    actualDividendUsd: 12.5,
    assets: [
      { symbol: "JEPQ", weightPct: 40, priceUsd: 56.86 },
      { symbol: "SCHD", weightPct: 30, priceUsd: 31 },
      { symbol: "JEPI", weightPct: 20, priceUsd: 57.67 },
      { symbol: "O", weightPct: 10, priceUsd: 67 }
    ],
    holdingsBefore: {
      JEPQ: 10,
      SCHD: 8,
      JEPI: 4,
      O: 2
    }
  });

  const jepq = result.buys.find((b) => b.symbol === "JEPQ");
  const schd = result.buys.find((b) => b.symbol === "SCHD");
  const jepi = result.buys.find((b) => b.symbol === "JEPI");
  const o = result.buys.find((b) => b.symbol === "O");

  assert.equal(jepq.sharesToBuy, 4);
  assert.equal(schd.sharesToBuy, 6);
  assert.equal(jepi.sharesToBuy, 2);
  assert.equal(o.sharesToBuy, 2);

  assert.equal(result.totalInvestedUsd, 662.78);
  assert.equal(result.leftoverUsd, 17.72);
  assert.equal(result.carryOutUsd, 30.22);
  assert.equal(result.netDividendReceivedUsd, 12.5);
});

test("validateInputs rejects negative net dividend value", () => {
  const error = validateInputs({
    monthlyBudgetKrw: 1000000,
    fxRate: 1400,
    carryInUsd: 0,
    actualDividendUsd: -0.01,
    assets: [{ symbol: "A", weightPct: 100, priceUsd: 10 }]
  });

  assert.ok(error.includes("세후 배당"));
});

test("recomputeCashflowChain cascades carry updates after late dividend edit", () => {
  const records = [
    {
      id: "m1",
      monthLabel: "2026-01",
      monthlyBudgetKrw: 1000000,
      fxRate: 1000,
      budgetUsd: 1000,
      initialCarryInUsd: 0,
      carryInUsd: 0,
      investableUsd: 1000,
      totalInvestedUsd: 900,
      leftoverUsd: 100,
      netDividendReceivedUsd: 0,
      carryOutUsd: 100,
      buys: [],
      holdingsAfter: {}
    },
    {
      id: "m2",
      monthLabel: "2026-02",
      monthlyBudgetKrw: 1000000,
      fxRate: 1000,
      budgetUsd: 1000,
      initialCarryInUsd: 100,
      carryInUsd: 100,
      investableUsd: 1100,
      totalInvestedUsd: 1000,
      leftoverUsd: 100,
      netDividendReceivedUsd: 0,
      carryOutUsd: 100,
      buys: [],
      holdingsAfter: {}
    }
  ];

  records[0].netDividendReceivedUsd = 20;
  const recalculated = recomputeCashflowChain(records);

  assert.equal(recalculated[0].carryOutUsd, 120);
  assert.equal(recalculated[1].carryInUsd, 120);
  assert.equal(recalculated[1].investableUsd, 1120);
  assert.equal(recalculated[1].leftoverUsd, 120);
  assert.equal(recalculated[1].carryOutUsd, 120);
});

test("calculateOverallSummary returns cumulative totals and holdings", () => {
  const records = [
    {
      id: "2026-01-a",
      monthLabel: "2026-01",
      monthlyBudgetKrw: 1000000,
      budgetUsd: 680.5,
      totalInvestedUsd: 600,
      netDividendReceivedUsd: 10,
      carryOutUsd: 90,
      buys: [
        { symbol: "JEPQ", sharesToBuy: 4, investedUsd: 220 },
        { symbol: "SCHD", sharesToBuy: 6, investedUsd: 180 }
      ],
      holdingsAfter: { JEPQ: 4, SCHD: 6 }
    },
    {
      id: "2026-02-a",
      monthLabel: "2026-02",
      monthlyBudgetKrw: 1000000,
      budgetUsd: 680.5,
      totalInvestedUsd: 640,
      netDividendReceivedUsd: 12,
      carryOutUsd: 88,
      buys: [
        { symbol: "JEPQ", sharesToBuy: 3, investedUsd: 168 },
        { symbol: "O", sharesToBuy: 1, investedUsd: 67 }
      ],
      holdingsAfter: { JEPQ: 7, SCHD: 6, O: 1 }
    }
  ];

  const overall = calculateOverallSummary(records, [
    { symbol: "JEPQ", priceUsd: 60 },
    { symbol: "SCHD", priceUsd: 32 },
    { symbol: "O", priceUsd: 70 }
  ]);

  assert.equal(overall.monthCount, 2);
  assert.equal(overall.totalBudgetKrw, 2000000);
  assert.equal(overall.totalBudgetUsd, 1361);
  assert.equal(overall.totalInvestedUsd, 1240);
  assert.equal(overall.totalDividendUsd, 22);
  assert.equal(overall.currentCarryUsd, 88);
  assert.equal(overall.currentMarketValueUsd, 682);
  assert.equal(overall.totalAccountValueUsd, 770);
  assert.equal(overall.totalPrincipalUsd, 1361);
  assert.equal(overall.totalProfitUsd, -591);
  assert.equal(overall.totalReturnPct, -43.42);
  assert.equal(overall.currentTotalShares, 14);

  const jepq = overall.holdings.find((row) => row.symbol === "JEPQ");
  const schd = overall.holdings.find((row) => row.symbol === "SCHD");
  const o = overall.holdings.find((row) => row.symbol === "O");

  assert.equal(jepq.totalBoughtShares, 7);
  assert.equal(jepq.currentShares, 7);
  assert.equal(jepq.totalInvestedUsd, 388);
  assert.equal(jepq.averageCostUsd, 55.43);
  assert.equal(jepq.currentPriceUsd, 60);
  assert.equal(jepq.marketValueUsd, 420);

  assert.equal(schd.totalBoughtShares, 6);
  assert.equal(schd.currentShares, 6);
  assert.equal(o.totalBoughtShares, 1);
  assert.equal(o.currentShares, 1);
});

test("calculateOverallSummary handles empty records", () => {
  const overall = calculateOverallSummary([]);

  assert.equal(overall.monthCount, 0);
  assert.equal(overall.totalInvestedUsd, 0);
  assert.equal(overall.totalDividendUsd, 0);
  assert.equal(overall.totalPrincipalUsd, 0);
  assert.equal(overall.currentMarketValueUsd, 0);
  assert.equal(overall.totalAccountValueUsd, 0);
  assert.equal(overall.totalProfitUsd, 0);
  assert.equal(overall.totalReturnPct, 0);
  assert.equal(overall.currentCarryUsd, 0);
  assert.deepEqual(overall.holdings, []);
});

test("recomputeHoldingsChain rebuilds cumulative holdings across months", () => {
  const records = [
    {
      id: "b",
      monthLabel: "2026-02",
      buys: [{ symbol: "JEPQ", sharesToBuy: 1, investedUsd: 50 }],
      holdingsAfter: {}
    },
    {
      id: "a",
      monthLabel: "2026-01",
      buys: [{ symbol: "JEPQ", sharesToBuy: 2, investedUsd: 100 }],
      holdingsAfter: {}
    }
  ];

  const result = recomputeHoldingsChain(records);

  assert.equal(result[0].monthLabel, "2026-01");
  assert.equal(result[1].monthLabel, "2026-02");
  assert.equal(result[0].buys[0].beforeShares, 0);
  assert.equal(result[0].buys[0].afterShares, 2);
  assert.equal(result[1].buys[0].beforeShares, 2);
  assert.equal(result[1].buys[0].afterShares, 3);
  assert.equal(result[1].holdingsAfter.JEPQ, 3);
});
