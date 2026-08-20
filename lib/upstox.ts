const BASE = 'https://api.upstox.com';

export async function upstoxFetch(path: string) {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('UPSTOX_ACCESS_TOKEN is not configured');

  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.errors?.[0]?.message || `Upstox request failed: ${res.status}`);
  }
  return body;
}

export async function getOHLC(instrumentKeys: string[], interval = '1d') {
  if (!instrumentKeys.length) return null;
  const keys = instrumentKeys.join(',');
  return upstoxFetch(`/v3/market-quote/ohlc?instrument_key=${encodeURIComponent(keys)}&interval=${encodeURIComponent(interval)}`);
}

export async function getIntradayCandles(instrumentKey: string, interval = 5) {
  return upstoxFetch(`/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/minutes/${interval}`);
}
