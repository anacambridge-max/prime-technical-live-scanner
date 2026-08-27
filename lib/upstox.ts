const BASE = 'https://api.upstox.com';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function upstoxFetch(path: string, attempts = 3) {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('UPSTOX_ACCESS_TOKEN is not configured');

  let lastError = 'Upstox request failed';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });

      const body = await res.json().catch(() => null);
      if (res.ok) return body;

      lastError = body?.errors?.[0]?.message || `Upstox request failed: ${res.status}`;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === attempts - 1) throw new Error(lastError);
      await sleep(350 * (attempt + 1));
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt === attempts - 1) throw new Error(lastError);
      await sleep(350 * (attempt + 1));
    }
  }

  throw new Error(lastError);
}

export async function getOHLC(instrumentKeys: string[], interval = '1d') {
  if (!instrumentKeys.length) return null;
  const keys = instrumentKeys.join(',');
  return upstoxFetch(`/v3/market-quote/ohlc?instrument_key=${encodeURIComponent(keys)}&interval=${encodeURIComponent(interval)}`);
}

export async function getIntradayCandles(instrumentKey: string, interval = 5) {
  return upstoxFetch(`/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/minutes/${interval}`);
}
