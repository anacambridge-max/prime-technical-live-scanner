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
    const distance = Math.abs(price - value) / Math.max(Math.abs(value), 1);
    if (distance <= tolerancePct && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? '—';
}

function rowFromCandles(symbol: string, candles: Candle[], daily: DailyQuote | undefined): ScanRow {
  const sorted = [...candles].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
  const now = Date.now();
  const closed = sorted.filter(c => new Date(c[0]).getTime() + 5 * 60 * 1000 <= now);
  const usable = closed.length >= 3 ? closed : sorted;

  const latest = usable[usable.length - 1];
  const previous = usable[usable.length - 2];
  const closes = usable.map(c => c[4]);
  const volumes = usable.map(c => c[5]);
  const current = latest[4];
  const prevClose = daily?.prev_ohlc?.close ?? previous?.[4] ?? current;
  const change = prevClose ? ((current - prevClose) / prevClose) * 100 : 0;
  const ema20 = ema(closes.slice(-60), 20);
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

  const levels: Record<string, number> = { YH: yh, YL: yl, MID: mid, R1: r1, S1: s1, R2: r2, S2: s2 };
  const level = nearestLevel(current, levels);

  let status: ScanRow['status'] = 'NO TRADE';
  let setup = '—';
  let reason = 'No valid Prime Technical sequence';
  let entry: number | null = null;
  let sl: number | null = null;
  let target: number | null = null;
  let signalTime: string | null = null;

  const bodyPct = (h: number, l: number, o: number, c: number) => {
    const range = h - l;
    return range > 0 ? Math.abs(c - o) / range * 100 : 0;
  };

  // Scan the last few closed candles. A setup candle must be followed by
  // a separate confirmation candle, so a single candle cannot create a signal.
  const start = Math.max(1, usable.length - 8);
  for (let i = start; i < usable.length; i++) {
    const c = usable[i];
    const p = usable[i - 1];
    const range = c[2] - c[3];
    const body = bodyPct(c[2], c[3], c[1], c[4]);
    const bull = c[4] > c[1] && body >= 50;
    const bear = c[4] < c[1] && body >= 50;
    const cEma = ema20;
    const vol = avgVol > 0 ? c[5] / avgVol : 0;

    const bullLevel =
      (Number.isFinite(yh) && c[3] <= yh && c[4] > yh) ||
      (Number.isFinite(yl) && c[3] <= yl && c[4] > yl) ||
      (Number.isFinite(mid) && c[3] <= mid && c[4] > mid) ||
      (Number.isFinite(r1) && c[3] <= r1 && c[4] > r1) ||
      (Number.isFinite(s1) && c[3] <= s1 && c[4] > s1);

    const bearLevel =
      (Number.isFinite(yh) && c[2] >= yh && c[4] < yh) ||
      (Number.isFinite(yl) && c[2] >= yl && c[4] < yl) ||
      (Number.isFinite(mid) && c[2] >= mid && c[4] < mid) ||
      (Number.isFinite(r1) && c[2] >= r1 && c[4] < r1) ||
      (Number.isFinite(s1) && c[2] >= s1 && c[4] < s1);

    const fakeBreakdown = Number.isFinite(yl) && c[3] < yl && c[4] > yl;
    const fakeBreakout = Number.isFinite(yh) && c[2] > yh && c[4] < yh;

    const longSetup = bull && (bullLevel || fakeBreakdown) && c[4] >= cEma;
    const shortSetup = bear && (bearLevel || fakeBreakout) && c[4] <= cEma;

    if (longSetup) {
      setup = fakeBreakdown ? 'FAKE BREAKDOWN' : 'LEVEL REACTION';
      status = 'SETUP';
      reason = fakeBreakdown ? 'YL reclaim + bullish candle' : 'Level reaction + bullish candle';
      entry = c[2];
      sl = fakeBreakdown ? c[3] : Math.min(c[3], p[3]);

      if (i + 1 < usable.length) {
        const n = usable[i + 1];
        const nBody = bodyPct(n[2], n[3], n[1], n[4]);
        const nBull = n[4] > n[1] && nBody >= 50;
        const nVol = avgVol > 0 ? n[5] / avgVol : 0;
        if (nBull && n[4] > c[2] && nVol >= 2 && n[4] > ema20) {
          const risk = n[2] - sl;
          if (risk > 0 && risk / n[2] <= 0.02) {
            status = 'CONFIRMED';
            reason = 'Confirmation candle + 2X volume + 20 EMA';
            entry = n[2];
            sl = sl;
            target = entry + risk * 2;
            signalTime = n[0];
          }
        }
      }
    }

    if (shortSetup) {
      setup = fakeBreakout ? 'FAKE BREAKOUT' : 'LEVEL REACTION';
      status = 'SETUP';
      reason = fakeBreakout ? 'YH rejection + bearish candle' : 'Level reaction + bearish candle';
      entry = c[3];
      sl = fakeBreakout ? c[2] : Math.max(c[2], p[2]);

      if (i + 1 < usable.length) {
        const n = usable[i + 1];
        const nBody = bodyPct(n[2], n[3], n[1], n[4]);
        const nBear = n[4] < n[1] && nBody >= 50;
        const nVol = avgVol > 0 ? n[5] / avgVol : 0;
        if (nBear && n[4] < c[3] && nVol >= 2 && n[4] < ema20) {
          const risk = sl - n[3];
          if (risk > 0 && risk / n[3] <= 0.02) {
            status = 'CONFIRMED';
            reason = 'Confirmation candle + 2X volume + 20 EMA';
            entry = n[3];
            target = entry - risk * 2;
            signalTime = n[0];
          }
        }
      }
    }
  }

  // Opening range context is shown only as a setup, never as an automatic trade.
  const opening = usable.find(c => {
    const d = new Date(c[0]);
    return d.getUTCHours() === 3 && d.getUTCMinutes() === 45; // 09:15 IST
  });
  if (status === 'NO TRADE' && opening) {
    if (current > opening[2] && current > ema20) {
      status = 'WATCH';
      setup = 'OPENING RANGE';
      reason = 'Above 09:15 opening high; waiting for confirmation';
    } else if (current < opening[3] && current < ema20) {
      status = 'WATCH';
      setup = 'OPENING RANGE';
      reason = 'Below 09:15 opening low; waiting for confirmation';
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
      dailyMap.set(key.replace(':', '|'), value);
    }
  }

  const rows: ScanRow[] = [];
  await chunk(universe, 8, async instrument => {
    try {
      const response = await getIntradayCandles(instrument.instrumentKey, 5);
      const candles = (response?.data?.candles ?? []) as Candle[];
      if (candles.length >= 3) rows.push(rowFromCandles(instrument.symbol, candles, dailyMap.get(instrument.instrumentKey)));
    } catch {
      // Skip an unavailable instrument without breaking the whole scanner.
    }
  });

  const priority: Record<ScanRow['status'], number> = { CONFIRMED: 0, SETUP: 1, WATCH: 2, 'NO TRADE': 3 };
  return rows.sort((a, b) => priority[a.status] - priority[b.status] || Math.abs(b.change) - Math.abs(a.change));
}
