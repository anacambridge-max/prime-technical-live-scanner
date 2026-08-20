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

function nearestLevel(price: number, levels: Record<string, number>, tolerancePct = 0.0015) {
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

function volumeLabel(x: number) {
  if (x >= 6) return 'EXTREME VOLUME';
  if (x >= 4) return 'VERY HIGH VOLUME';
  if (x >= 2) return 'HIGH VOLUME';
  if (x >= 1.5) return 'STRONG VOLUME';
  return 'NORMAL VOLUME';
}

function crossedAbove(c: Candle, level: number) {
  return Number.isFinite(level) && c[3] <= level && c[4] > level;
}

function crossedBelow(c: Candle, level: number) {
  return Number.isFinite(level) && c[2] >= level && c[4] < level;
}

function nearLevel(price: number, level: number, tolerancePct = 0.0035) {
  return Number.isFinite(level) && Math.abs(price - level) / Math.max(Math.abs(level), 1) <= tolerancePct;
}

function rowFromCandles(symbol: string, candles: Candle[], daily: DailyQuote | undefined): ScanRow {
  const sorted = [...candles].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  const now = Date.now();
  const closed = sorted.filter(c => new Date(c[0]).getTime() + 5 * 60 * 1000 <= now);
  const usable = closed.length >= 25 ? closed : sorted;
  const latest = usable[usable.length - 1];
  const previous = usable[usable.length - 2];
  const closes = usable.map(c => c[4]);
  const volumes = usable.map(c => c[5]);
  const current = latest[4];
  const prevClose = daily?.prev_ohlc?.close ?? previous?.[4] ?? current;
  const change = prevClose ? ((current - prevClose) / prevClose) * 100 : 0;

  const ema20 = ema(closes.slice(-60), 20);
  const emaBull = Number.isFinite(ema20) && current > ema20;
  const emaBear = Number.isFinite(ema20) && current < ema20;
  const avgVol = average(volumes.slice(Math.max(0, volumes.length - 21), -1));
  const latestVol = avgVol > 0 ? latest[5] / avgVol : 0;
  const previousVol = avgVol > 0 && previous ? previous[5] / avgVol : 0;

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
  const levels: Record<string, number> = { PDH: yh, PDL: yl, MID: mid, R1: r1, R2: r2, R3: r3, S1: s1, S2: s2, S3: s3 };
  const level = nearestLevel(current, levels);

  // First 5-minute candle = opening-range reference candle.
  const opening = usable.find(c => {
    const d = new Date(c[0]);
    return d.getUTCHours() === 3 && d.getUTCMinutes() === 45;
  });
  const orHigh = opening?.[2] ?? NaN;
  const orLow = opening?.[3] ?? NaN;

  /*
   * PRIME TECHNICAL TWO-STAGE CONFIRMATION
   * --------------------------------------
   * A SETUP candle is preparation/reaction at a meaningful trigger level.
   * It must NOT already close through that trigger.
   *
   * CONFIRMED requires the immediately following candle to:
   *   1) close beyond the setup candle's extreme,
   *   2) close beyond the actual PDH/PDL or OR trigger,
   *   3) have directional candle strength,
   *   4) have >= 2x relative volume,
   *   5) remain aligned with the 20 EMA.
   *
   * This deliberately prevents the same breakout/breakdown candle from
   * becoming both SETUP and CONFIRMED.
   */
  const latestBody = bodyPct(latest);
  const prevBody = previous ? bodyPct(previous) : 0;
  const latestBull = latest[4] > latest[1] && latestBody >= 55;
  const latestBear = latest[4] < latest[1] && latestBody >= 55;
  const prevBull = previous ? previous[4] > previous[1] && prevBody >= 50 : false;
  const prevBear = previous ? previous[4] < previous[1] && prevBody >= 50 : false;

  // SETUP reaction candles: they approach/test the level but close on the
  // non-broken side. A wick through the level is allowed (rejection).
  const prevOrBullSetup = !!previous && Number.isFinite(orHigh) &&
    previous[2] >= orHigh && previous[4] <= orHigh &&
    nearLevel(previous[4], orHigh);
  const prevOrBearSetup = !!previous && Number.isFinite(orLow) &&
    previous[3] <= orLow && previous[4] >= orLow &&
    nearLevel(previous[4], orLow);

  const prevPdhBullSetup = !!previous && Number.isFinite(yh) &&
    previous[2] >= yh && previous[4] <= yh &&
    nearLevel(previous[4], yh);
  const prevPdlBearSetup = !!previous && Number.isFinite(yl) &&
    previous[3] <= yl && previous[4] >= yl &&
    nearLevel(previous[4], yl);

  const prevLongSetup = !!previous && prevBull && previousVol >= 1.5 && emaBull &&
    (prevOrBullSetup || prevPdhBullSetup);
  const prevShortSetup = !!previous && prevBear && previousVol >= 1.5 && emaBear &&
    (prevOrBearSetup || prevPdlBearSetup);

  const longTrigger = prevOrBullSetup ? orHigh : prevPdhBullSetup ? yh : NaN;
  const shortTrigger = prevOrBearSetup ? orLow : prevPdlBearSetup ? yl : NaN;

  // FINAL CONFIRMATION must be a new candle after the reaction/setup candle.
  const longConfirmed = prevLongSetup && latestBull && latestVol >= 2 && emaBull &&
    latest[4] > previous![2] && latest[4] > longTrigger;
  const shortConfirmed = prevShortSetup && latestBear && latestVol >= 2 && emaBear &&
    latest[4] < previous![3] && latest[4] < shortTrigger;

  // Current candle can be shown as SETUP, but only if it is still a reaction
  // candle. A candle that has already broken the trigger is not a SETUP.
  const latestOrBullSetup = Number.isFinite(orHigh) && latest[2] >= orHigh && latest[4] <= orHigh && nearLevel(latest[4], orHigh);
  const latestOrBearSetup = Number.isFinite(orLow) && latest[3] <= orLow && latest[4] >= orLow && nearLevel(latest[4], orLow);
  const latestPdhBullSetup = Number.isFinite(yh) && latest[2] >= yh && latest[4] <= yh && nearLevel(latest[4], yh);
  const latestPdlBearSetup = Number.isFinite(yl) && latest[3] <= yl && latest[4] >= yl && nearLevel(latest[4], yl);

  const latestLongSetup = latestBull && latestVol >= 1.5 && emaBull && (latestOrBullSetup || latestPdhBullSetup);
  const latestShortSetup = latestBear && latestVol >= 1.5 && emaBear && (latestOrBearSetup || latestPdlBearSetup);

  let status: ScanRow['status'] = 'NO TRADE';
  let setup = '—';
  let reason = 'No current Prime Technical setup';
  let entry: number | null = null;
  let sl: number | null = null;
  let target: number | null = null;
  let signalTime: string | null = null;

  if (longConfirmed) {
    setup = prevOrBullSetup ? 'OR BREAKOUT' : 'PDH BREAKOUT';
    status = 'CONFIRMED';
    entry = latest[2];
    sl = Math.min(previous![3], latest[3]);
    const risk = entry - sl;
    if (risk > 0 && risk / entry <= 0.02) target = entry + risk * 2;
    reason = `${setup} + FOLLOW-THROUGH confirmation candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA`;
    signalTime = latest[0];
  } else if (shortConfirmed) {
    setup = prevOrBearSetup ? 'OR BREAKDOWN' : 'PDL BREAKDOWN';
    status = 'CONFIRMED';
    entry = latest[3];
    sl = Math.max(previous![2], latest[2]);
    const risk = sl - entry;
    if (risk > 0 && risk / entry <= 0.02) target = entry - risk * 2;
    reason = `${setup} + FOLLOW-THROUGH confirmation candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA`;
    signalTime = latest[0];
  } else if (latestLongSetup) {
    setup = latestOrBullSetup ? 'OR BREAKOUT SETUP' : 'PDH BREAKOUT SETUP';
    status = 'SETUP';
    entry = Number.isFinite(latest[2]) ? latest[2] : null;
    sl = latest[3];
    reason = `${setup} + bullish reaction candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA; FOLLOW-THROUGH CONFIRMATION PENDING`;
    signalTime = latest[0];
  } else if (latestShortSetup) {
    setup = latestOrBearSetup ? 'OR BREAKDOWN SETUP' : 'PDL BREAKDOWN SETUP';
    status = 'SETUP';
    entry = Number.isFinite(latest[3]) ? latest[3] : null;
    sl = latest[2];
    reason = `${setup} + bearish reaction candle + ${latestVol.toFixed(1)}X ${volumeLabel(latestVol)} + 20 EMA; FOLLOW-THROUGH CONFIRMATION PENDING`;
    signalTime = latest[0];
  } else if (emaBull && latestVol >= 1.0) {
    status = 'WATCH';
    setup = 'BUY WATCH';
    reason = 'Above 20 EMA; waiting for PDH/OR reaction and breakout confirmation';
  } else if (emaBear && latestVol >= 1.0) {
    status = 'WATCH';
    setup = 'SELL WATCH';
    reason = 'Below 20 EMA; waiting for PDL/OR reaction and breakdown confirmation';
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
      if (candles.length >= 25) {
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
