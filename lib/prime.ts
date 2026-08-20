import { getOHLC, getIntradayCandles } from './upstox';
import type { PrimeInstrument } from './instruments';

export type ScanRow = {
  symbol: string; ltp: number; change: number; volumeX: number; ema: string; level: string; setup: string;
  status: 'WATCH' | 'SETUP' | 'CONFIRMED' | 'NO TRADE'; entry: number | null; sl: number | null; target: number | null;
  reason: string; signalTime: string | null;
};

type Candle = [string, number, number, number, number, number, number];
type DailyQuote = { last_price?: number; prev_ohlc?: { close?: number; high?: number; low?: number }; live_ohlc?: { close?: number; high?: number; low?: number } };

function ema(values: number[], length: number) {
  if (!values.length) return NaN;
  const k = 2 / (length + 1); let result = values[0];
  for (let i = 1; i < values.length; i++) result = values[i] * k + result * (1 - k);
  return result;
}
function average(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function bodyPct(c: Candle) { const range = c[2] - c[3]; return range > 0 ? Math.abs(c[4] - c[1]) / range * 100 : 0; }
function trueRange(c: Candle, prevClose?: number) {
  const range = c[2] - c[3]; if (!Number.isFinite(prevClose)) return range;
  return Math.max(range, Math.abs(c[2] - prevClose!), Math.abs(c[3] - prevClose!));
}
function atr(candles: Candle[], length = 14) {
  if (candles.length < 2) return 0; const ranges: number[] = [];
  for (let i = Math.max(1, candles.length - length); i < candles.length; i++) ranges.push(trueRange(candles[i], candles[i - 1]?.[4]));
  return average(ranges);
}
function volumeLabel(x: number) {
  if (x >= 6) return 'EXTREME VOLUME'; if (x >= 4) return 'VERY HIGH VOLUME'; if (x >= 2) return 'HIGH VOLUME';
  if (x >= 1.5) return 'STRONG VOLUME'; return 'NORMAL VOLUME';
}
function nearLevel(price: number, level: number, tolerancePct = 0.0035) {
  return Number.isFinite(level) && Math.abs(price - level) / Math.max(Math.abs(level), 1) <= tolerancePct;
}
function indiaDate(timestamp: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

function rowFromCandles(symbol: string, candles: Candle[], daily?: DailyQuote): ScanRow {
  const sorted = [...candles].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  const now = Date.now();
  const closed = sorted.filter(c => new Date(c[0]).getTime() + 5 * 60 * 1000 <= now);
  const usable = closed.length >= 30 ? closed : sorted;
  const latest = usable[usable.length - 1]; const previous = usable[usable.length - 2];
  if (!latest || !previous) return { symbol, ltp: 0, change: 0, volumeX: 0, ema: '—', level: '—', setup: '—', status: 'NO TRADE', entry: null, sl: null, target: null, reason: 'Insufficient 5-minute candles', signalTime: null };

  const candleClose = latest[4];
  const livePrice = Number.isFinite(daily?.last_price) ? daily!.last_price! : candleClose;
  const closes = usable.map(c => c[4]); const volumes = usable.map(c => c[5]);
  const prevClose = daily?.prev_ohlc?.close ?? previous[4] ?? candleClose;
  const change = prevClose ? ((livePrice - prevClose) / prevClose) * 100 : 0;
  const ema20 = ema(closes.slice(-60), 20); const ema20Prev = ema(closes.slice(-61, -1), 20);
  const emaBull = Number.isFinite(ema20) && candleClose > ema20; const emaBear = Number.isFinite(ema20) && candleClose < ema20;
  const emaRising = Number.isFinite(ema20) && Number.isFinite(ema20Prev) && ema20 >= ema20Prev;
  const emaFalling = Number.isFinite(ema20) && Number.isFinite(ema20Prev) && ema20 <= ema20Prev;
  const avgVol = average(volumes.slice(Math.max(0, volumes.length - 21), -1));
  const latestVol = avgVol > 0 ? latest[5] / avgVol : 0;

  // PDH / PDL are the PRIMARY levels. OR levels are intentionally not used for confirmation.
  const pdh = daily?.prev_ohlc?.high ?? NaN; const pdl = daily?.prev_ohlc?.low ?? NaN;
  const pdhDistance = Number.isFinite(pdh) ? Math.abs(livePrice - pdh) / Math.max(Math.abs(pdh), 1) : Infinity;
  const pdlDistance = Number.isFinite(pdl) ? Math.abs(livePrice - pdl) / Math.max(Math.abs(pdl), 1) : Infinity;
  let level = '—';
  if (pdhDistance <= 0.005 && pdhDistance <= pdlDistance) level = 'PDH'; else if (pdlDistance <= 0.005) level = 'PDL';

  const today = indiaDate(latest[0]); const todayCandles = usable.filter(c => indiaDate(c[0]) === today); const latestTodayIndex = todayCandles.length - 1;
  const pdhBreakIndices: number[] = []; const pdlBreakIndices: number[] = [];
  todayCandles.forEach((c, i) => {
    if (Number.isFinite(pdh) && c[4] > pdh && c[1] <= pdh) pdhBreakIndices.push(i);
    if (Number.isFinite(pdl) && c[4] < pdl && c[1] >= pdl) pdlBreakIndices.push(i);
  });
  const lastPdhBreak = pdhBreakIndices.length ? pdhBreakIndices[pdhBreakIndices.length - 1] : -1;
  const lastPdlBreak = pdlBreakIndices.length ? pdlBreakIndices[pdlBreakIndices.length - 1] : -1;
  const pdhBreakRecent = lastPdhBreak >= 0 && latestTodayIndex - lastPdhBreak <= 6;
  const pdlBreakRecent = lastPdlBreak >= 0 && latestTodayIndex - lastPdlBreak <= 6;
  const pdhBrokenToday = lastPdhBreak >= 0; const pdlBrokenToday = lastPdlBreak >= 0;

  const latestBull = latest[4] > latest[1] && bodyPct(latest) >= 50;
  const latestBear = latest[4] < latest[1] && bodyPct(latest) >= 50;
  const previousBull = previous[4] > previous[1] && bodyPct(previous) >= 45;
  const previousBear = previous[4] < previous[1] && bodyPct(previous) >= 45;
  const liveAbovePdh = Number.isFinite(pdh) && livePrice > pdh; const liveBelowPdl = Number.isFinite(pdl) && livePrice < pdl;

  const latestPdhBreak = Number.isFinite(pdh) && latest[4] > pdh && latest[1] <= pdh;
  const latestPdlBreak = Number.isFinite(pdl) && latest[4] < pdl && latest[1] >= pdl;
  const avgAtr = atr(usable, 14);
  const pullbackBull = Number.isFinite(ema20) && avgAtr > 0 && emaBull && emaRising && latest[3] <= ema20 + avgAtr * 0.65 && candleClose > ema20;
  const pullbackBear = Number.isFinite(ema20) && avgAtr > 0 && emaBear && emaFalling && latest[2] >= ema20 - avgAtr * 0.65 && candleClose < ema20;

  // CONFIRMED requires PDH/PDL. OR/EMA cannot independently confirm.
  const buyFollowThrough = previousBull && latestBull && latestVol >= 2 && candleClose > previous[2] && emaBull && liveAbovePdh;
  const sellFollowThrough = previousBear && latestBear && latestVol >= 2 && candleClose < previous[3] && emaBear && liveBelowPdl;
  const pdhConfirmed = Number.isFinite(pdh) && pdhBreakRecent && buyFollowThrough;
  const pdlConfirmed = Number.isFinite(pdl) && pdlBreakRecent && sellFollowThrough;
  const pdhBreakSetup = Number.isFinite(pdh) && latestPdhBreak && latestBull && latestVol >= 1.5 && emaBull;
  const pdlBreakSetup = Number.isFinite(pdl) && latestPdlBreak && latestBear && latestVol >= 1.5 && emaBear;
  const bullishContinuationSetup = pdhBrokenToday && liveAbovePdh && pullbackBull && latestBull && latestVol >= 1.5 && candleClose > previous[2];
  const bearishContinuationSetup = pdlBrokenToday && liveBelowPdl && pullbackBear && latestBear && latestVol >= 1.5 && candleClose < previous[3];

  // Keep WATCH focused: only stocks within 0.5% of PDH/PDL are candidates.
  const nearPdh = Number.isFinite(pdh) && pdhDistance <= 0.005; const nearPdl = Number.isFinite(pdl) && pdlDistance <= 0.005;
  let status: ScanRow['status'] = 'NO TRADE'; let setup = '—'; let reason = 'No current PDH/PDL Prime Technical setup';
  let entry: number | null = null; let sl: number | null = null; let target: number | null = null; let signalTime: string | null = null;

  if (pdhConfirmed) {
    setup = 'PDH BUY'; status = 'CONFIRMED'; entry = livePrice; sl = Math.min(previous[3], latest[3], pdh);
    const risk = entry - sl; if (risk > 0 && risk / entry <= 0.02) target = entry + risk * 2;
    reason = `PDH breakout + follow-through + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA + price above PDH`; signalTime = latest[0];
  } else if (pdlConfirmed) {
    setup = 'PDL SELL'; status = 'CONFIRMED'; entry = livePrice; sl = Math.max(previous[2], latest[2], pdl);
    const risk = sl - entry; if (risk > 0 && risk / entry <= 0.02) target = entry - risk * 2;
    reason = `PDL breakdown + follow-through + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA + price below PDL`; signalTime = latest[0];
  } else if (pdhBreakSetup) {
    setup = 'PDH BUY SETUP'; status = 'SETUP'; entry = livePrice; sl = latest[3];
    reason = `PDH breakout candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + bullish 20 EMA; next candle confirmation pending`; signalTime = latest[0];
  } else if (pdlBreakSetup) {
    setup = 'PDL SELL SETUP'; status = 'SETUP'; entry = livePrice; sl = latest[2];
    reason = `PDL breakdown candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + bearish 20 EMA; next candle confirmation pending`; signalTime = latest[0];
  } else if (bullishContinuationSetup) {
    setup = 'BUY CONTINUATION SETUP'; status = 'SETUP'; entry = livePrice; sl = Math.min(latest[3], ema20, pdh);
    reason = `PDH already broken + 20 EMA pullback + bullish continuation + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)}; confirmation pending`; signalTime = latest[0];
  } else if (bearishContinuationSetup) {
    setup = 'SELL CONTINUATION SETUP'; status = 'SETUP'; entry = livePrice; sl = Math.max(latest[2], ema20, pdl);
    reason = `PDL already broken + 20 EMA pullback + bearish continuation + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)}; confirmation pending`; signalTime = latest[0];
  } else if (nearPdh || nearPdl) {
    status = 'WATCH'; setup = nearPdh && nearPdl ? 'PDH/PDL WATCH' : nearPdh ? 'PDH WATCH' : 'PDL WATCH';
    reason = nearPdh ? `Price ${liveAbovePdh ? 'above' : 'near/below'} PDH; waiting for PDH breakout + follow-through` : `Price ${liveBelowPdl ? 'below' : 'near/above'} PDL; waiting for PDL breakdown + follow-through`;
  }

  return { symbol, ltp: livePrice, change, volumeX: latestVol, ema: livePrice >= ema20 ? 'BULLISH' : 'BEARISH', level, setup, status, entry, sl, target, reason, signalTime };
}

async function chunk<T>(items: T[], size: number, fn: (item: T) => Promise<void>) { for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn)); }

export async function scanUniverse(universe: PrimeInstrument[]) {
  const dailyMap = new Map<string, DailyQuote>(); const dailyKeys = universe.map(x => x.instrumentKey);
  for (let i = 0; i < dailyKeys.length; i += 50) {
    const part = dailyKeys.slice(i, i + 50); const quote = await getOHLC(part, '1d');
    for (const [key, value] of Object.entries((quote?.data ?? {}) as Record<string, DailyQuote>)) dailyMap.set(key, value);
  }
  const rows: ScanRow[] = [];
  await chunk(universe, 8, async instrument => {
    try {
      const response = await getIntradayCandles(instrument.instrumentKey, 5); const candles = (response?.data?.candles ?? []) as Candle[];
      if (candles.length >= 30) rows.push(rowFromCandles(instrument.symbol, candles, dailyMap.get(instrument.instrumentKey)));
    } catch { /* Skip temporarily unavailable instruments. */ }
  });
  const priority: Record<ScanRow['status'], number> = { CONFIRMED: 0, SETUP: 1, WATCH: 2, 'NO TRADE': 3 };
  return rows.sort((a, b) => priority[a.status] - priority[b.status] || Math.abs(b.change) - Math.abs(a.change));
}
