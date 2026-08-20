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
    if (distance <= tolerancePct && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? '—';
}

function bodyPct(c: Candle) {
  const range = c[2] - c[3];
  return range > 0 ? Math.abs(c[4] - c[1]) / range * 100 : 0;
}

function volumeLabel(volumeX: number) {
  if (volumeX >= 6) return 'EXTREME VOLUME';
  if (volumeX >= 4) return 'VERY HIGH VOLUME';
  if (volumeX >= 2) return 'HIGH VOLUME';
  if (volumeX >= 1.5) return 'STRONG VOLUME';
  return 'NORMAL VOLUME';
}

function crossedAbove(c: Candle, level: number) {
  return Number.isFinite(level) && c[3] <= level && c[4] > level;
}

function crossedBelow(c: Candle, level: number) {
  return Number.isFinite(level) && c[2] >= level && c[4] < level;
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
  const emaPrev = ema(closes.slice(-61, -1), 20);
  const emaBull = Number.isFinite(ema20) && Number.isFinite(emaPrev) && ema20 > emaPrev;
  const emaBear = Number.isFinite(ema20) && Number.isFinite(emaPrev) && ema20 < emaPrev;

  const avgVol = average(volumes.slice(Math.max(0, volumes.length - 21), -1));
  const volumeX = avgVol > 0 ? latest[5] / avgVol : 0;

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

  const levels: Record<string, number> = { YH: yh, YL: yl, MID: mid, R1: r1, R2: r2, R3: r3, S1: s1, S2: s2, S3: s3 };
  const level = nearestLevel(current, levels);

  let status: ScanRow['status'] = 'NO TRADE';
  let setup = '—';
  let reason = 'No complete Prime Technical setup';
  let entry: number | null = null;
  let sl: number | null = null;
  let target: number | null = null;
  let signalTime: string | null = null;

  const opening = usable.find(c => {
    const d = new Date(c[0]);
    return d.getUTCHours() === 3 && d.getUTCMinutes() === 45;
  });
  const orHigh = opening?.[2] ?? NaN;
  const orLow = opening?.[3] ?? NaN;

  const levelValues = Object.entries(levels).filter(([, value]) => Number.isFinite(value)) as [string, number][];
  const recentStart = Math.max(20, usable.length - 10);

  for (let i = recentStart; i < usable.length - 1; i++) {
    const c = usable[i];
    const n = usable[i + 1];
    const cBody = bodyPct(c);
    const bull = c[4] > c[1] && cBody >= 55;
    const bear = c[4] < c[1] && cBody >= 55;
    const cVol = avgVol > 0 ? c[5] / avgVol : 0;
    const cVolLabel = volumeLabel(cVol);

    const touchedBull = levelValues.find(([, v]) => crossedAbove(c, v));
    const touchedBear = levelValues.find(([, v]) => crossedBelow(c, v));
    const fakeBreakdown = Number.isFinite(yl) && c[3] < yl && c[4] > yl;
    const fakeBreakout = Number.isFinite(yh) && c[2] > yh && c[4] < yh;
    const orBreakBull = Number.isFinite(orHigh) && crossedAbove(c, orHigh);
    const orBreakBear = Number.isFinite(orLow) && crossedBelow(c, orLow);

    const longInteraction = Boolean(touchedBull || fakeBreakdown || orBreakBull);
    const shortInteraction = Boolean(touchedBear || fakeBreakout || orBreakBear);
    const longSetup = bull && longInteraction && cVol >= 1.5 && c[4] > ema20 && emaBull;
    const shortSetup = bear && shortInteraction && cVol >= 1.5 && c[4] < ema20 && emaBear;

    if (longSetup) {
      setup = fakeBreakdown ? 'FAKE BREAKDOWN' : orBreakBull ? 'OR BREAKOUT' : 'LEVEL REACTION';
      status = 'SETUP';
      reason = `${setup} + bullish candle + ${cVol.toFixed(1)}X ${cVolLabel} + 20 EMA`;
      entry = c[2];
      sl = fakeBreakdown ? c[3] : Math.min(c[3], previous?.[3] ?? c[3]);

      const nBody = bodyPct(n);
      const nBull = n[4] > n[1] && nBody >= 50;
      const nVol = avgVol > 0 ? n[5] / avgVol : 0;
      if (nBull && n[4] > c[2] && nVol >= 2 && n[4] > ema20) {
        const risk = n[2] - sl;
        if (risk > 0 && risk / n[2] <= 0.02) {
          status = 'CONFIRMED';
          reason = `Setup + confirmation candle + ${nVol.toFixed(1)}X ${volumeLabel(nVol)} + 20 EMA`;
          entry = n[2];
          target = entry + risk * 2;
          signalTime = n[0];
        }
      }
    }

    if (shortSetup) {
      setup = fakeBreakout ? 'FAKE BREAKOUT' : orBreakBear ? 'OR BREAKDOWN' : 'LEVEL REJECTION';
      status = 'SETUP';
      reason = `${setup} + bearish candle + ${cVol.toFixed(1)}X ${cVolLabel} + 20 EMA`;
      entry = c[3];
      sl = fakeBreakout ? c[2] : Math.max(c[2], previous?.[2] ?? c[2]);

      const nBody = bodyPct(n);
      const nBear = n[4] < n[1] && nBody >= 50;
      const nVol = avgVol > 0 ? n[5] / avgVol : 0;
      if (nBear && n[4] < c[3] && nVol >= 2 && n[4] < ema20) {
        const risk = sl - n[3];
        if (risk > 0 && risk / n[3] <= 0.02) {
          status = 'CONFIRMED';
          reason = `Setup + confirmation candle + ${nVol.toFixed(1)}X ${volumeLabel(nVol)} + 20 EMA`;
          entry = n[3];
          target = entry - risk * 2;
          signalTime = n[0];
        }
      }
    }
  }

  if (status === 'NO TRADE') {
    const last = usable[usable.length - 1];
    const lastBody = bodyPct(last);
    const lastVol = avgVol > 0 ? last[5] / avgVol : 0;
    const bull = last[4] > last[1] && lastBody >= 55;
    const bear = last[4] < last[1] && lastBody >= 55;
    const nearLevel = nearestLevel(last[4], levels, 0.0025);
    const orBull = Number.isFinite(orHigh) && last[4] > orHigh;
    const orBear = Number.isFinite(orLow) && last[4] < orLow;
    const lastVolLabel = volumeLabel(lastVol);

    if (bull && nearLevel !== '—' && lastVol >= 1.5 && last[4] > ema20 && emaBull) {
      status = 'WATCH';
      setup = 'LEVEL SETUP';
      reason = `Strong bullish candle at ${nearLevel} + ${lastVol.toFixed(1)}X ${lastVolLabel}; confirmation pending`;
    } else if (bear && nearLevel !== '—' && lastVol >= 1.5 && last[4] < ema20 && emaBear) {
      status = 'WATCH';
      setup = 'LEVEL SETUP';
      reason = `Strong bearish candle at ${nearLevel} + ${lastVol.toFixed(1)}X ${lastVolLabel}; confirmation pending`;
    } else if (bull && orBull && lastVol >= 1.5 && last[4] > ema20 && emaBull) {
      status = 'WATCH';
      setup = 'OR BREAKOUT';
      reason = `09:15 range breakout + ${lastVol.toFixed(1)}X ${lastVolLabel} + 20 EMA; confirmation pending`;
    } else if (bear && orBear && lastVol >= 1.5 && last[4] < ema20 && emaBear) {
      status = 'WATCH';
      setup = 'OR BREAKDOWN';
      reason = `09:15 range breakdown + ${lastVol.toFixed(1)}X ${lastVolLabel} + 20 EMA; confirmation pending`;
    }
  }

  return {
    symbol,
    ltp: current,
    change,
    volumeX,
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
      if (candles.length >= 25) rows.push(rowFromCandles(instrument.symbol, candles, dailyMap.get(instrument.instrumentKey)));
    } catch {
      // Skip an unavailable instrument without breaking the whole scanner.
    }
  });

  const priority: Record<ScanRow['status'], number> = { CONFIRMED: 0, SETUP: 1, WATCH: 2, 'NO TRADE': 3 };
  return rows.sort((a, b) => priority[a.status] - priority[b.status] || Math.abs(b.change) - Math.abs(a.change));
}
