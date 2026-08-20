import { getOHLC, getIntradayCandles } from './upstox';
import type { PrimeInstrument } from './instruments';

export type ScanRow = {
  symbol: string;
  ltp: number;
  change: number;
  volumeX: number;
  ema: string;
  level: string;
  setup: string;
  status: 'WATCH' | 'SETUP' | 'CONFIRMED' | 'NO TRADE';
  entry: number | null;
  sl: number | null;
  target: number | null;
  reason: string;
  signalTime: string | null;
};

type Candle = [string, number, number, number, number, number, number];
type DailyQuote = {
  last_price?: number;
  prev_ohlc?: { close?: number; high?: number; low?: number };
  live_ohlc?: { close?: number; high?: number; low?: number };
};

function ema(values: number[], length: number) {
  if (!values.length) return NaN;
  const k = 2 / (length + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) result = values[i] * k + result * (1 - k);
  return result;
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function nearestLevel(price: number, levels: Record<string, number>, tolerancePct = 0.002) {
  let best: { name: string; distance: number } | null = null;
  for (const [name, value] of Object.entries(levels)) {
    if (!Number.isFinite(value)) continue;
    const distance = Math.abs(price - value) / Math.max(Math.abs(value), 1);
    if (distance <= tolerancePct && (!best || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name ?? '—';
}

function bodyPct(c: Candle) {
  const range = c[2] - c[3];
  return range > 0 ? Math.abs(c[4] - c[1]) / range * 100 : 0;
}

function trueRange(c: Candle, prevClose: number | undefined) {
  const range = c[2] - c[3];
  if (!Number.isFinite(prevClose)) return range;
  return Math.max(range, Math.abs(c[2] - prevClose!), Math.abs(c[3] - prevClose!));
}

function atr(candles: Candle[], length = 14) {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = Math.max(1, candles.length - length); i < candles.length; i++) {
    ranges.push(trueRange(candles[i], candles[i - 1]?.[4]));
  }
  return average(ranges);
}

function volumeLabel(x: number) {
  if (x >= 6) return 'EXTREME VOLUME';
  if (x >= 4) return 'VERY HIGH VOLUME';
  if (x >= 2) return 'HIGH VOLUME';
  if (x >= 1.5) return 'STRONG VOLUME';
  return 'NORMAL VOLUME';
}

function nearLevel(price: number, level: number, tolerancePct = 0.0035) {
  return Number.isFinite(level) && Math.abs(price - level) / Math.max(Math.abs(level), 1) <= tolerancePct;
}

function rowFromCandles(symbol: string, candles: Candle[], daily: DailyQuote | undefined): ScanRow {
  const sorted = [...candles].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  const now = Date.now();
  const closed = sorted.filter(c => new Date(c[0]).getTime() + 5 * 60 * 1000 <= now);
  const usable = closed.length >= 30 ? closed : sorted;
  const latest = usable[usable.length - 1];
  const previous = usable[usable.length - 2];
  const closes = usable.map(c => c[4]);
  const volumes = usable.map(c => c[5]);
  const current = latest[4];

  const prevClose = daily?.prev_ohlc?.close ?? previous?.[4] ?? current;
  const change = prevClose ? ((current - prevClose) / prevClose) * 100 : 0;

  // Same 20 EMA concept as the TradingView chart, plus slope.
  const ema20 = ema(closes.slice(-60), 20);
  const ema20Prev = ema(closes.slice(-61, -1), 20);
  const emaBull = Number.isFinite(ema20) && current > ema20;
  const emaBear = Number.isFinite(ema20) && current < ema20;
  const emaRising = Number.isFinite(ema20) && Number.isFinite(ema20Prev) && ema20 >= ema20Prev;
  const emaFalling = Number.isFinite(ema20) && Number.isFinite(ema20Prev) && ema20 <= ema20Prev;

  const avgVol = average(volumes.slice(Math.max(0, volumes.length - 21), -1));
  const latestVol = avgVol > 0 ? latest[5] / avgVol : 0;
  const previousVol = avgVol > 0 && previous ? previous[5] / avgVol : 0;

  // Previous-day reference lines: green PDH / red PDL on the TradingView chart.
  const yh = daily?.prev_ohlc?.high ?? NaN;
  const yl = daily?.prev_ohlc?.low ?? NaN;
  const pc = prevClose;
  const mid = Number.isFinite(yh) && Number.isFinite(yl) ? (yh + yl) / 2 : NaN;
  const pp = Number.isFinite(yh) && Number.isFinite(yl) ? (yh + yl + pc) / 3 : NaN;
  const r1 = Number.isFinite(pp) ? 2 * pp - yl : NaN;
  const s1 = Number.isFinite(pp) ? 2 * pp - yh : NaN;
  const r2 = Number.isFinite(pp) ? pp + (yh - yl) : NaN;
  const s2 = Number.isFinite(pp) ? pp - (yh - yl) : NaN;
  const r3 = Number.isFinite(pp) ? yh + 2 * (pp - yl) : NaN;
  const s3 = Number.isFinite(pp) ? yl - 2 * (yh - pp) : NaN;
  const levels: Record<string, number> = {
    PDH: yh, PDL: yl, MID: mid, R1: r1, R2: r2, R3: r3, S1: s1, S2: s2, S3: s3
  };
  const level = nearestLevel(current, levels);

  // First 5-minute candle = opening-range reference candle.
  const opening = usable.find(c => {
    const d = new Date(c[0]);
    return d.getUTCHours() === 3 && d.getUTCMinutes() === 45;
  });
  const orHigh = opening?.[2] ?? NaN;
  const orLow = opening?.[3] ?? NaN;

  const latestBody = bodyPct(latest);
  const prevBody = previous ? bodyPct(previous) : 0;
  const latestBull = latest[4] > latest[1] && latestBody >= 50;
  const latestBear = latest[4] < latest[1] && latestBody >= 50;
  const prevBull = previous ? previous[4] > previous[1] && prevBody >= 45 : false;
  const prevBear = previous ? previous[4] < previous[1] && prevBody >= 45 : false;
  const avgAtr = atr(usable, 14);

  /*
   * PRIME TECHNICAL SETUP ENGINE
   *
   * The TradingView examples show two families of setups:
   *  1) PDH/PDL and OR level reactions/breakouts.
   *  2) Trend-continuation setups after an impulse/pullback around the 20 EMA.
   *
   * SETUP = opportunity/developing signal.
   * CONFIRMED = only the immediately following candle's follow-through.
   */

  // ---------- PDH / PDL / OR LEVEL SETUPS ----------
  const latestPdhBreak = Number.isFinite(yh) && latest[4] > yh && latest[1] <= yh;
  const latestPdlBreak = Number.isFinite(yl) && latest[4] < yl && latest[1] >= yl;
  const latestOrBreak = Number.isFinite(orHigh) && latest[4] > orHigh && latest[1] <= orHigh;
  const latestOrDown = Number.isFinite(orLow) && latest[4] < orLow && latest[1] >= orLow;

  const prevPdhBreak = !!previous && Number.isFinite(yh) && previous[4] > yh && previous[1] <= yh;
  const prevPdlBreak = !!previous && Number.isFinite(yl) && previous[4] < yl && previous[1] >= yl;
  const prevOrBreak = !!previous && Number.isFinite(orHigh) && previous[4] > orHigh && previous[1] <= orHigh;
  const prevOrDown = !!previous && Number.isFinite(orLow) && previous[4] < orLow && previous[1] >= orLow;

  const latestPdhReaction = Number.isFinite(yh) && latest[2] >= yh && latest[4] <= yh && nearLevel(latest[4], yh);
  const latestPdlReaction = Number.isFinite(yl) && latest[3] <= yl && latest[4] >= yl && nearLevel(latest[4], yl);
  const latestOrReaction = Number.isFinite(orHigh) && latest[2] >= orHigh && latest[4] <= orHigh && nearLevel(latest[4], orHigh);
  const latestOrReject = Number.isFinite(orLow) && latest[3] <= orLow && latest[4] >= orLow && nearLevel(latest[4], orLow);

  const prevPdhReaction = !!previous && Number.isFinite(yh) && previous[2] >= yh && previous[4] <= yh && nearLevel(previous[4], yh);
  const prevPdlReaction = !!previous && Number.isFinite(yl) && previous[3] <= yl && previous[4] >= yl && nearLevel(previous[4], yl);
  const prevOrReaction = !!previous && Number.isFinite(orHigh) && previous[2] >= orHigh && previous[4] <= orHigh && nearLevel(previous[4], orHigh);
  const prevOrReject = !!previous && Number.isFinite(orLow) && previous[3] <= orLow && previous[4] >= orLow && nearLevel(previous[4], orLow);

  const prevLevelLong = prevBull && previousVol >= 1.5 && emaBull &&
    (prevPdhBreak || prevOrBreak || prevPdhReaction || prevOrReaction);
  const prevLevelShort = prevBear && previousVol >= 1.5 && emaBear &&
    (prevPdlBreak || prevOrDown || prevPdlReaction || prevOrReject);

  const latestLevelLong = latestBull && latestVol >= 1.5 && emaBull &&
    (latestPdhBreak || latestOrBreak || latestPdhReaction || latestOrReaction);
  const latestLevelShort = latestBear && latestVol >= 1.5 && emaBear &&
    (latestPdlBreak || latestOrDown || latestPdlReaction || latestOrReject);

  // ---------- PRIME TECHNICAL 20 EMA CONTINUATION SETUPS ----------
  // These reproduce the repeated SETUP labels visible on TINDIA, MOTILAL,
  // PAYTM and BAJFINANCE: impulse -> controlled pullback -> reaction from 20 EMA.
  const lookback = usable.slice(Math.max(0, usable.length - 8), -1);
  const priorHigh = lookback.length ? Math.max(...lookback.map(c => c[2])) : NaN;
  const priorLow = lookback.length ? Math.min(...lookback.map(c => c[3])) : NaN;
  const priorClose = previous?.[4] ?? current;

  const priorImpulseBull = Number.isFinite(priorHigh) && Number.isFinite(priorLow) && Number.isFinite(avgAtr) && avgAtr > 0 &&
    priorHigh - priorLow >= avgAtr * 1.2 && priorClose > ema20;
  const priorImpulseBear = Number.isFinite(priorHigh) && Number.isFinite(priorLow) && Number.isFinite(avgAtr) && avgAtr > 0 &&
    priorHigh - priorLow >= avgAtr * 1.2 && priorClose < ema20;

  const pullbackToEmaBull = emaBull && emaRising && Number.isFinite(avgAtr) && avgAtr > 0 &&
    latest[3] <= ema20 + avgAtr * 0.65 && current > ema20;
  const pullbackToEmaBear = emaBear && emaFalling && Number.isFinite(avgAtr) && avgAtr > 0 &&
    latest[2] >= ema20 - avgAtr * 0.65 && current < ema20;

  const bullishContinuation = latestBull && latestVol >= 1.5 && priorImpulseBull && pullbackToEmaBull &&
    current > previous[2];
  const bearishContinuation = latestBear && latestVol >= 1.5 && priorImpulseBear && pullbackToEmaBear &&
    current < previous[3];

  const prevLookback = usable.slice(Math.max(0, usable.length - 9), -2);
  const prevHigh = prevLookback.length ? Math.max(...prevLookback.map(c => c[2])) : NaN;
  const prevLow = prevLookback.length ? Math.min(...prevLookback.map(c => c[3])) : NaN;
  const prevAvgAtr = atr(usable.slice(0, -1), 14);
  const prevPullbackBull = emaBull && emaRising && Number.isFinite(prevAvgAtr) && prevAvgAtr > 0 &&
    previous[3] <= ema20 + prevAvgAtr * 0.65 && previous[4] > ema20;
  const prevPullbackBear = emaBear && emaFalling && Number.isFinite(prevAvgAtr) && prevAvgAtr > 0 &&
    previous[2] >= ema20 - prevAvgAtr * 0.65 && previous[4] < ema20;
  const prevImpulseBull = Number.isFinite(prevHigh) && Number.isFinite(prevLow) && Number.isFinite(prevAvgAtr) && prevAvgAtr > 0 &&
    prevHigh - prevLow >= prevAvgAtr * 1.2 && previous[4] > ema20;
  const prevImpulseBear = Number.isFinite(prevHigh) && Number.isFinite(prevLow) && Number.isFinite(prevAvgAtr) && prevAvgAtr > 0 &&
    prevHigh - prevLow >= prevAvgAtr * 1.2 && previous[4] < ema20;

  const twoBarsAgo = usable[usable.length - 3];
  const prevContinuationLong = prevBull && previousVol >= 1.5 && prevImpulseBull && prevPullbackBull &&
    previous[4] > (twoBarsAgo?.[2] ?? previous[1]);
  const prevContinuationShort = prevBear && previousVol >= 1.5 && prevImpulseBear && prevPullbackBear &&
    previous[4] < (twoBarsAgo?.[3] ?? previous[1]);

  // ---------- FOLLOW-THROUGH CONFIRMATION ----------
  const longLevelConfirmed = prevLevelLong && latestBull && latestVol >= 2 && emaBull &&
    ((prevPdhBreak || prevPdhReaction) ? latest[4] > yh :
      (prevOrBreak || prevOrReaction) ? latest[4] > orHigh : false) &&
    latest[4] > previous![2];

  const shortLevelConfirmed = prevLevelShort && latestBear && latestVol >= 2 && emaBear &&
    ((prevPdlBreak || prevPdlReaction) ? latest[4] < yl :
      (prevOrDown || prevOrReject) ? latest[4] < orLow : false) &&
    latest[4] < previous![3];

  const longContinuationConfirmed = prevContinuationLong && latestBull && latestVol >= 2 && emaBull &&
    latest[4] > previous![2];
  const shortContinuationConfirmed = prevContinuationShort && latestBear && latestVol >= 2 && emaBear &&
    latest[4] < previous![3];

  let status: ScanRow['status'] = 'NO TRADE';
  let setup = '—';
  let reason = 'No current Prime Technical setup';
  let entry: number | null = null;
  let sl: number | null = null;
  let target: number | null = null;
  let signalTime: string | null = null;

  if (longLevelConfirmed) {
    setup = (prevPdhBreak || prevPdhReaction) ? 'PDH BUY' : 'OR HIGH BUY';
    status = 'CONFIRMED';
    entry = latest[2];
    sl = Math.min(previous![3], latest[3]);
    const risk = entry - sl;
    if (risk > 0 && risk / entry <= 0.02) target = entry + risk * 2;
    reason = `${setup} + follow-through confirmation + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA`;
    signalTime = latest[0];
  } else if (shortLevelConfirmed) {
    setup = (prevPdlBreak || prevPdlReaction) ? 'PDL SELL' : 'OR LOW SELL';
    status = 'CONFIRMED';
    entry = latest[3];
    sl = Math.max(previous![2], latest[2]);
    const risk = sl - entry;
    if (risk > 0 && risk / entry <= 0.02) target = entry - risk * 2;
    reason = `${setup} + follow-through confirmation + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA`;
    signalTime = latest[0];
  } else if (longContinuationConfirmed) {
    setup = 'BUY CONTINUATION';
    status = 'CONFIRMED';
    entry = latest[2];
    sl = Math.min(previous![3], latest[3]);
    const risk = entry - sl;
    if (risk > 0 && risk / entry <= 0.02) target = entry + risk * 2;
    reason = `20 EMA pullback + bullish continuation + follow-through + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)}`;
    signalTime = latest[0];
  } else if (shortContinuationConfirmed) {
    setup = 'SELL CONTINUATION';
    status = 'CONFIRMED';
    entry = latest[3];
    sl = Math.max(previous![2], latest[2]);
    const risk = sl - entry;
    if (risk > 0 && risk / entry <= 0.02) target = entry - risk * 2;
    reason = `20 EMA pullback + bearish continuation + follow-through + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)}`;
    signalTime = latest[0];
  } else if (latestLevelLong) {
    setup = (latestPdhBreak || latestPdhReaction) ? 'PDH BUY SETUP' : 'OR HIGH BUY SETUP';
    status = 'SETUP';
    entry = latest[2];
    sl = latest[3];
    reason = `${setup} + bullish setup candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA; confirmation pending`;
    signalTime = latest[0];
  } else if (latestLevelShort) {
    setup = (latestPdlBreak || latestPdlReaction) ? 'PDL SELL SETUP' : 'OR LOW SELL SETUP';
    status = 'SETUP';
    entry = latest[3];
    sl = latest[2];
    reason = `${setup} + bearish setup candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA; confirmation pending`;
    signalTime = latest[0];
  } else if (bullishContinuation) {
    setup = 'BUY CONTINUATION SETUP';
    status = 'SETUP';
    entry = latest[2];
    sl = Math.min(latest[3], ema20);
    reason = `20 EMA pullback + bullish continuation candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)}; confirmation pending`;
    signalTime = latest[0];
  } else if (bearishContinuation) {
    setup = 'SELL CONTINUATION SETUP';
    status = 'SETUP';
    entry = latest[3];
    sl = Math.max(latest[2], ema20);
    reason = `20 EMA pullback + bearish continuation candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)}; confirmation pending`;
    signalTime = latest[0];
  } else if (emaBull && emaRising && latestVol >= 1.0) {
    status = 'WATCH';
    setup = 'BUY WATCH';
    reason = 'Above rising 20 EMA; waiting for PDH/OR reaction or 20 EMA continuation setup';
  } else if (emaBear && emaFalling && latestVol >= 1.0) {
    status = 'WATCH';
    setup = 'SELL WATCH';
    reason = 'Below falling 20 EMA; waiting for PDL/OR reaction or 20 EMA continuation setup';
  }

  return {
    symbol,
    ltp: current,
    change,
    volumeX: latestVol,
    ema: Number.isFinite(ema20) ? (current >= ema20 ? 'BULLISH' : 'BEARISH') : '—',
    level,
    setup,
    status,
    entry,
    sl,
    target,
    reason,
    signalTime,
  };
}

async function chunk<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function scanUniverse(universe: PrimeInstrument[]) {
  const dailyMap = new Map<string, DailyQuote>();
  const dailyKeys = universe.map(x => x.instrumentKey);

  for (let i = 0; i < dailyKeys.length; i += 50) {
    const part = dailyKeys.slice(i, i + 50);
    const quote = await getOHLC(part, '1d');
    for (const [key, value] of Object.entries((quote?.data ?? {}) as Record<string, DailyQuote>)) {
      dailyMap.set(key, value);
    }
  }

  const rows: ScanRow[] = [];
  await chunk(universe, 8, async instrument => {
    try {
      const response = await getIntradayCandles(instrument.instrumentKey, 5);
      const candles = (response?.data?.candles ?? []) as Candle[];
      if (candles.length >= 30) {
        rows.push(rowFromCandles(instrument.symbol, candles, dailyMap.get(instrument.instrumentKey)));
      }
    } catch {
      // Skip temporarily unavailable instruments.
    }
  });

  const priority: Record<ScanRow['status'], number> = {
    CONFIRMED: 0,
    SETUP: 1,
    WATCH: 2,
    'NO TRADE': 3,
  };

  return rows.sort((a, b) => priority[a.status] - priority[b.status] || Math.abs(b.change) - Math.abs(a.change));
}
