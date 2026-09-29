// Stock fundamentals from SEC EDGAR XBRL company facts (official, free, no key).
// Flow items (revenue, net income, cash flow) use trailing twelve months when a
// newer 10-Q exists: TTM = last fiscal year + current YTD - prior-year YTD.
import { logger } from "./logger";

const SEC_HEADERS = { "User-Agent": "JB-Termometro/1.0 (jb-termometro-bursatil.vercel.app; admin@jb-termometro-bursatil.vercel.app)", Accept: "application/json" };
const DAY = 86_400_000;

type Fact = { start?: string; end: string; val: number; form?: string; fy?: number; fp?: string; filed?: string };
type CompanyFacts = { facts?: Record<string, Record<string, { units?: Record<string, Fact[]> }>> };

let tickerMap: { expiresAt: number; map: Map<string, number> } | null = null;
const factsCache = new Map<string, { expiresAt: number; facts: CompanyFacts }>();

async function secJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: SEC_HEADERS, signal: controller.signal });
    if (!response.ok) throw new Error(`SEC respondió ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cikFor(ticker: string): Promise<number | null> {
  if (!tickerMap || tickerMap.expiresAt < Date.now()) {
    const json = (await secJson("https://www.sec.gov/files/company_tickers.json")) as Record<string, { cik_str: number; ticker: string }>;
    tickerMap = { expiresAt: Date.now() + 24 * 3600_000, map: new Map(Object.values(json).map((row) => [row.ticker.toUpperCase(), row.cik_str])) };
  }
  return tickerMap.map.get(ticker.toUpperCase().replace(".", "-")) ?? tickerMap.map.get(ticker.toUpperCase()) ?? null;
}

async function companyFacts(cik: number): Promise<CompanyFacts> {
  const key = String(cik);
  const hit = factsCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.facts;
  const facts = (await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${key.padStart(10, "0")}.json`, 15000)) as CompanyFacts;
  // Keep only the tags we use so the cache stays small.
  const slim: CompanyFacts = { facts: {} };
  for (const [taxonomy, tags] of Object.entries(facts.facts ?? {})) {
    for (const [tag, body] of Object.entries(tags)) {
      if (!WANTED.has(tag)) continue;
      (slim.facts![taxonomy] ??= {})[tag] = body;
    }
  }
  factsCache.set(key, { expiresAt: Date.now() + 6 * 3600_000, facts: slim });
  if (factsCache.size > 200) factsCache.delete(factsCache.keys().next().value as string);
  return slim;
}

const TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  debtTotal: ["LongTermDebt", "DebtLongtermAndShorttermCombinedAmount"],
  debtNoncurrent: ["LongTermDebtNoncurrent"],
  debtCurrent: ["LongTermDebtCurrent"],
  assetsCurrent: ["AssetsCurrent"],
  liabilitiesCurrent: ["LiabilitiesCurrent"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment"],
  dividendsPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  shares: ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
} as const;
const WANTED = new Set<string>(Object.values(TAGS).flat());

function days(fact: Fact): number | null {
  return fact.start ? (Date.parse(fact.end) - Date.parse(fact.start)) / DAY : null;
}

function factsFor(facts: CompanyFacts, tags: readonly string[], unit: "USD" | "USD/shares" | "shares"): Fact[] {
  // Choose the tag with the most recent data; companies switch tags over time.
  let best: Fact[] = [];
  for (const tag of tags) {
    for (const taxonomy of ["us-gaap", "dei"]) {
      const list = facts.facts?.[taxonomy]?.[tag]?.units?.[unit] ?? [];
      const clean = list.filter((fact) => Number.isFinite(fact.val) && (!fact.form || /^(10-K|10-Q|20-F|40-F)/.test(fact.form)));
      if (clean.length && (!best.length || clean.reduce((m, f) => (f.end > m ? f.end : m), "") > best.reduce((m, f) => (f.end > m ? f.end : m), ""))) best = clean;
    }
  }
  // Deduplicate by period, keeping the latest filing.
  const byPeriod = new Map<string, Fact>();
  for (const fact of best) {
    const key = `${fact.start ?? ""}|${fact.end}`;
    const prev = byPeriod.get(key);
    if (!prev || (fact.filed ?? "") > (prev.filed ?? "")) byPeriod.set(key, fact);
  }
  return [...byPeriod.values()];
}

function latestInstant(list: Fact[]): number | null {
  const instants = list.filter((fact) => !fact.start || (days(fact) ?? 0) < 5).sort((a, b) => b.end.localeCompare(a.end));
  return instants[0]?.val ?? null;
}

type Flow = { ttm: number | null; lastYear: number | null; priorYear: number | null };

function flow(list: Fact[]): Flow {
  const annual = list.filter((fact) => { const d = days(fact); return d !== null && d > 340 && d < 390; }).sort((a, b) => b.end.localeCompare(a.end));
  const last = annual[0];
  if (!last) return { ttm: null, lastYear: null, priorYear: null };
  const prior = annual.find((fact) => Math.abs(Date.parse(last.end) - Date.parse(fact.end) - 365 * DAY) < 20 * DAY);
  let ttm = last.val;
  const fiscalStart = Date.parse(last.end) + DAY;
  const ytd = list
    .filter((fact) => fact.start && Math.abs(Date.parse(fact.start) - fiscalStart) < 10 * DAY && fact.end > last.end && (days(fact) ?? 400) < 340)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
  if (ytd) {
    const priorYtd = list.find((fact) => fact.start && Math.abs(Date.parse(fact.start) - (fiscalStart - 365 * DAY)) < 20 * DAY
      && Math.abs(Date.parse(ytd.end) - Date.parse(fact.end) - 365 * DAY) < 20 * DAY && (days(fact) ?? 400) < 340);
    if (priorYtd) ttm = last.val + ytd.val - priorYtd.val;
  }
  return { ttm, lastYear: last.val, priorYear: prior?.val ?? null };
}

const r2 = (value: number) => Number(value.toFixed(2));
const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? a / b : null);
const pctOf = (a: number | null, b: number | null) => { const value = ratio(a, b); return value === null ? null : r2(value * 100); };

export async function getSecFundamentals(ticker: string, price: number): Promise<Record<string, number | string | null> | null> {
  try {
    const cik = await cikFor(ticker);
    if (!cik) return null; // ETFs and non-US listings are not in the SEC company list
    const facts = await companyFacts(cik);
    const revenue = flow(factsFor(facts, TAGS.revenue, "USD"));
    const netIncome = flow(factsFor(facts, TAGS.netIncome, "USD"));
    const gross = flow(factsFor(facts, TAGS.grossProfit, "USD"));
    const operating = flow(factsFor(facts, TAGS.operatingIncome, "USD"));
    const eps = flow(factsFor(facts, TAGS.eps, "USD/shares"));
    const ocf = flow(factsFor(facts, TAGS.operatingCashFlow, "USD"));
    const capex = flow(factsFor(facts, TAGS.capex, "USD"));
    const dividends = flow(factsFor(facts, TAGS.dividendsPaid, "USD"));
    const equity = latestInstant(factsFor(facts, TAGS.equity, "USD"));
    const debtTotal = latestInstant(factsFor(facts, TAGS.debtTotal, "USD"));
    const debtNon = latestInstant(factsFor(facts, TAGS.debtNoncurrent, "USD"));
    const debtCur = latestInstant(factsFor(facts, TAGS.debtCurrent, "USD"));
    const debt = debtTotal ?? (debtNon !== null || debtCur !== null ? (debtNon ?? 0) + (debtCur ?? 0) : null);
    const assetsCurrent = latestInstant(factsFor(facts, TAGS.assetsCurrent, "USD"));
    const liabilitiesCurrent = latestInstant(factsFor(facts, TAGS.liabilitiesCurrent, "USD"));
    const shares = latestInstant(factsFor(facts, TAGS.shares, "shares"));
    const marketCap = shares !== null && price > 0 ? price * shares : null;
    const fcf = ocf.ttm !== null ? ocf.ttm - (capex.ttm ?? 0) : null;
    const pe = eps.ttm !== null && eps.ttm > 0 ? r2(price / eps.ttm) : null;
    return {
      source: "SEC EDGAR",
      marketCap,
      trailingPE: pe,
      trailingEps: eps.ttm === null ? null : r2(eps.ttm),
      priceToSales: marketCap !== null && revenue.ttm ? r2(marketCap / revenue.ttm) : null,
      priceToBook: marketCap !== null && equity ? r2(marketCap / equity) : null,
      grossMargin: pctOf(gross.ttm, revenue.ttm),
      operatingMargin: pctOf(operating.ttm, revenue.ttm),
      profitMargin: pctOf(netIncome.ttm, revenue.ttm),
      returnOnEquity: equity && equity > 0 ? pctOf(netIncome.ttm, equity) : null,
      revenueGrowth: revenue.lastYear !== null && revenue.priorYear ? r2((revenue.lastYear / revenue.priorYear - 1) * 100) : null,
      earningsGrowth: netIncome.lastYear !== null && netIncome.priorYear && netIncome.priorYear > 0 ? r2((netIncome.lastYear / netIncome.priorYear - 1) * 100) : null,
      debtToEquity: debt !== null && equity && equity > 0 ? r2((debt / equity) * 100) : null,
      currentRatio: assetsCurrent !== null && liabilitiesCurrent ? r2(assetsCurrent / liabilitiesCurrent) : null,
      freeCashflow: fcf,
      payoutRatio: dividends.ttm !== null && netIncome.ttm && netIncome.ttm > 0 ? r2((Math.abs(dividends.ttm) / netIncome.ttm) * 100) : null,
      revenueTtm: revenue.ttm,
      netIncomeTtm: netIncome.ttm,
    };
  } catch (error) {
    logger.warn({ err: error, ticker }, "SEC fundamentals unavailable");
    return null;
  }
}
