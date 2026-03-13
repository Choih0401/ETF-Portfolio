export const STORAGE_KEY = "etf_monthly_dashboard_v1";

export const DEFAULT_ASSETS = [
  { symbol: "JEPQ", weightPct: 40, priceUsd: 56.86 },
  { symbol: "SCHD", weightPct: 30, priceUsd: 31.0 },
  { symbol: "JEPI", weightPct: 20, priceUsd: 57.67 },
  { symbol: "O", weightPct: 10, priceUsd: 67.0 }
];

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function validateInputs({
  monthlyBudgetKrw,
  fxRate,
  carryInUsd,
  actualDividendUsd,
  assets
}) {
  if (monthlyBudgetKrw <= 0) {
    return "월 투자금(KRW)은 0보다 커야 합니다.";
  }
  if (fxRate <= 0) {
    return "환율(USD/KRW)은 0보다 커야 합니다.";
  }
  if (carryInUsd < 0) {
    return "이월금(USD)은 음수가 될 수 없습니다.";
  }
  if (actualDividendUsd < 0) {
    return "실제 세후 배당금(USD)은 음수가 될 수 없습니다.";
  }

  for (const asset of assets) {
    if (asset.weightPct < 0) {
      return `${asset.symbol} 비중은 음수가 될 수 없습니다.`;
    }
    if (asset.priceUsd <= 0) {
      return `${asset.symbol} 현재가는 0보다 커야 합니다.`;
    }
  }

  const weightSum = round2(assets.reduce((sum, a) => sum + asNumber(a.weightPct), 0));
  if (Math.abs(weightSum - 100) > 0.01) {
    return `비중 합계가 100%가 아닙니다. 현재 ${weightSum}%`;
  }

  return "";
}

export function calculateMonthlyPlan({
  monthLabel,
  monthlyBudgetKrw,
  fxRate,
  carryInUsd,
  actualDividendUsd,
  assets,
  holdingsBefore
}) {
  const budgetUsd = monthlyBudgetKrw / fxRate;
  const investableUsd = budgetUsd + carryInUsd;

  const buys = assets.map((asset) => {
    const weight = asset.weightPct / 100;
    const targetUsd = investableUsd * weight;
    const sharesToBuy = Math.floor(targetUsd / asset.priceUsd);
    const investedUsd = sharesToBuy * asset.priceUsd;
    const beforeShares = asNumber(holdingsBefore[asset.symbol]);
    const afterShares = beforeShares + sharesToBuy;

    return {
      symbol: asset.symbol,
      weightPct: asset.weightPct,
      priceUsd: round2(asset.priceUsd),
      targetUsd: round2(targetUsd),
      sharesToBuy,
      investedUsd: round2(investedUsd),
      beforeShares,
      afterShares
    };
  });

  const totalInvestedUsd = round2(buys.reduce((sum, b) => sum + b.investedUsd, 0));
  const leftoverUsd = round2(investableUsd - totalInvestedUsd);
  const netDividendReceivedUsd = round2(actualDividendUsd);
  const carryOutUsd = round2(leftoverUsd + netDividendReceivedUsd);

  const holdingsAfter = {};
  for (const buy of buys) {
    holdingsAfter[buy.symbol] = buy.afterShares;
  }

  return {
    id: `${monthLabel}-${Date.now()}`,
    monthLabel,
    monthlyBudgetKrw: Math.round(monthlyBudgetKrw),
    fxRate,
    budgetUsd: round2(budgetUsd),
    initialCarryInUsd: round2(carryInUsd),
    carryInUsd: round2(carryInUsd),
    investableUsd: round2(investableUsd),
    totalInvestedUsd,
    leftoverUsd,
    netDividendReceivedUsd,
    actualDividendUsd: netDividendReceivedUsd,
    carryOutUsd,
    buys,
    holdingsAfter,
    createdAt: new Date().toISOString()
  };
}

export function recomputeCashflowChain(records) {
  const sorted = records
    .slice()
    .sort((a, b) => String(a.monthLabel).localeCompare(String(b.monthLabel)));

  const recalculated = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const record = sorted[i];
    const prev = recalculated[i - 1];

    const budgetUsd = round2(
      asNumber(record.budgetUsd, asNumber(record.monthlyBudgetKrw) / asNumber(record.fxRate, 1))
    );

    const carryInUsd =
      i === 0
        ? round2(asNumber(record.initialCarryInUsd, asNumber(record.carryInUsd)))
        : round2(asNumber(prev.carryOutUsd));

    const investableUsd = round2(budgetUsd + carryInUsd);
    const totalInvestedUsd = round2(asNumber(record.totalInvestedUsd));
    const leftoverUsd = round2(investableUsd - totalInvestedUsd);
    const netDividendReceivedUsd = round2(
      asNumber(record.netDividendReceivedUsd, asNumber(record.actualDividendUsd))
    );
    const carryOutUsd = round2(leftoverUsd + netDividendReceivedUsd);

    recalculated.push({
      ...record,
      budgetUsd,
      carryInUsd,
      investableUsd,
      totalInvestedUsd,
      leftoverUsd,
      netDividendReceivedUsd,
      actualDividendUsd: netDividendReceivedUsd,
      carryOutUsd
    });
  }

  return recalculated;
}

export function recomputeHoldingsChain(records) {
  const sorted = records
    .slice()
    .sort((a, b) => String(a.monthLabel).localeCompare(String(b.monthLabel)));

  const runningHoldings = {};

  return sorted.map((record) => {
    const buys = Array.isArray(record.buys) ? record.buys : [];

    const normalizedBuys = buys.map((buy) => {
      const symbol = String(buy.symbol || "").toUpperCase();
      if (!symbol) {
        return {
          ...buy,
          beforeShares: asNumber(buy.beforeShares),
          afterShares: asNumber(buy.afterShares)
        };
      }

      const beforeShares = asNumber(runningHoldings[symbol]);
      const sharesToBuy = asNumber(buy.sharesToBuy);
      const afterShares = beforeShares + sharesToBuy;
      runningHoldings[symbol] = afterShares;

      return {
        ...buy,
        symbol,
        beforeShares,
        afterShares
      };
    });

    return {
      ...record,
      buys: normalizedBuys,
      holdingsAfter: { ...runningHoldings }
    };
  });
}

export function calculateOverallSummary(records, assets = []) {
  if (!records.length) {
    return {
      monthCount: 0,
      totalBudgetKrw: 0,
      totalBudgetUsd: 0,
      totalInvestedUsd: 0,
      totalDividendUsd: 0,
      totalPrincipalUsd: 0,
      currentMarketValueUsd: 0,
      totalAccountValueUsd: 0,
      totalProfitUsd: 0,
      totalReturnPct: 0,
      currentCarryUsd: 0,
      currentTotalShares: 0,
      holdings: []
    };
  }

  const sorted = records
    .slice()
    .sort((a, b) => String(a.monthLabel).localeCompare(String(b.monthLabel)));

  let totalBudgetKrw = 0;
  let totalBudgetUsd = 0;
  let totalInvestedUsd = 0;
  let totalDividendUsd = 0;

  const symbolMap = new Map();
  const assetPriceMap = new Map(
    assets
      .map((asset) => [String(asset.symbol || "").toUpperCase(), asNumber(asset.priceUsd)])
      .filter(([symbol, price]) => symbol && price > 0)
  );
  let latestHoldings = {};

  for (const record of sorted) {
    totalBudgetKrw += asNumber(record.monthlyBudgetKrw);
    totalBudgetUsd += asNumber(record.budgetUsd);
    totalInvestedUsd += asNumber(record.totalInvestedUsd);
    totalDividendUsd += asNumber(
      record.netDividendReceivedUsd,
      asNumber(record.actualDividendUsd)
    );

    const buys = Array.isArray(record.buys) ? record.buys : [];
    for (const buy of buys) {
      const symbol = buy.symbol;
      if (!symbol) {
        continue;
      }

      if (!symbolMap.has(symbol)) {
        symbolMap.set(symbol, {
          symbol,
          totalBoughtShares: 0,
          totalInvestedUsd: 0
        });
      }

      const found = symbolMap.get(symbol);
      found.totalBoughtShares += asNumber(buy.sharesToBuy);
      found.totalInvestedUsd += asNumber(buy.investedUsd);
    }

    latestHoldings =
      record.holdingsAfter && typeof record.holdingsAfter === "object"
        ? record.holdingsAfter
        : latestHoldings;
  }

  for (const symbol of Object.keys(latestHoldings)) {
    if (!symbolMap.has(symbol)) {
      symbolMap.set(symbol, {
        symbol,
        totalBoughtShares: 0,
        totalInvestedUsd: 0
      });
    }
  }

  const holdings = Array.from(symbolMap.values())
    .map((item) => {
      const currentShares = asNumber(
        latestHoldings[item.symbol],
        asNumber(item.totalBoughtShares)
      );
      const averageCostUsd =
        item.totalBoughtShares > 0
          ? round2(item.totalInvestedUsd / item.totalBoughtShares)
          : 0;

      return {
        symbol: item.symbol,
        totalBoughtShares: asNumber(item.totalBoughtShares),
        currentShares,
        currentPriceUsd: round2(
          asNumber(assetPriceMap.get(String(item.symbol).toUpperCase()), averageCostUsd)
        ),
        totalInvestedUsd: round2(item.totalInvestedUsd),
        averageCostUsd,
        marketValueUsd: round2(
          currentShares *
            asNumber(assetPriceMap.get(String(item.symbol).toUpperCase()), averageCostUsd)
        )
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const currentCarryUsd = asNumber(sorted[sorted.length - 1].carryOutUsd);
  const currentMarketValueUsd = round2(
    holdings.reduce((sum, holding) => sum + asNumber(holding.marketValueUsd), 0)
  );
  const totalAccountValueUsd = round2(currentMarketValueUsd + currentCarryUsd);
  const firstInitialCarryUsd = round2(asNumber(sorted[0].initialCarryInUsd, 0));
  const totalPrincipalUsd = round2(totalBudgetUsd + firstInitialCarryUsd);
  const totalProfitUsd = round2(totalAccountValueUsd - totalPrincipalUsd);
  const totalReturnPct = totalPrincipalUsd > 0 ? round2((totalProfitUsd / totalPrincipalUsd) * 100) : 0;
  const currentTotalShares = holdings.reduce(
    (sum, holding) => sum + asNumber(holding.currentShares),
    0
  );

  return {
    monthCount: sorted.length,
    totalBudgetKrw: Math.round(totalBudgetKrw),
    totalBudgetUsd: round2(totalBudgetUsd),
    totalInvestedUsd: round2(totalInvestedUsd),
    totalDividendUsd: round2(totalDividendUsd),
    totalPrincipalUsd,
    currentMarketValueUsd,
    totalAccountValueUsd,
    totalProfitUsd,
    totalReturnPct,
    currentCarryUsd: round2(currentCarryUsd),
    currentTotalShares,
    holdings
  };
}

export function getLastHoldings(records) {
  if (!records.length) {
    return {};
  }
  return records[records.length - 1].holdingsAfter;
}

export function getLastCarry(records) {
  if (!records.length) {
    return 0;
  }
  return asNumber(records[records.length - 1].carryOutUsd);
}
