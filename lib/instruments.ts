import { gunzipSync } from 'node:zlib';

export type PrimeInstrument = {
  symbol: string;
  instrumentKey: string;
};

type UpstoxInstrument = {
  segment?: string;
  instrument_type?: string;
  underlying_type?: string;
  underlying_symbol?: string;
  underlying_key?: string;
  instrument_key?: string;
  trading_symbol?: string;
  expiry?: number;
};

const NSE_FILE = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';

let cachedUniverse: PrimeInstrument[] | null = null;
let cachedAt = 0;

export async function getPrimeUniverse(): Promise<PrimeInstrument[]> {
  const configured = process.env.PRIME_SYMBOLS?.split(',').map(s => s.trim()).filter(Boolean);
  if (configured?.length) {
    return configured.map(symbol => ({ symbol, instrumentKey: symbol }));
  }

  const now = Date.now();
  if (cachedUniverse && now - cachedAt < 6 * 60 * 60 * 1000) return cachedUniverse;

  const res = await fetch(NSE_FILE, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Unable to download Upstox NSE instruments: ${res.status}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  const instruments = JSON.parse(raw) as UpstoxInstrument[];

  const today = Date.now();
  const nearestFuture = new Map<string, UpstoxInstrument>();
  const equities = new Map<string, UpstoxInstrument>();

  for (const item of instruments) {
    if (item.segment === 'NSE_EQ' && item.instrument_type === 'EQ' && item.instrument_key) {
      equities.set(item.instrument_key, item);
    }

    if (
      item.segment === 'NSE_FO' &&
      item.instrument_type === 'FUT' &&
      item.underlying_type === 'EQUITY' &&
      item.underlying_key &&
      item.underlying_symbol &&
      item.expiry &&
      item.expiry >= today
    ) {
      const previous = nearestFuture.get(item.underlying_key);
      if (!previous || (previous.expiry ?? Number.MAX_SAFE_INTEGER) > item.expiry) {
        nearestFuture.set(item.underlying_key, item);
      }
    }
  }

  const universe = [...nearestFuture.entries()]
    .map(([underlyingKey, future]) => ({
      symbol: future.underlying_symbol as string,
      instrumentKey: underlyingKey,
    }))
    .filter(item => equities.has(item.instrumentKey))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const maxSymbols = Math.max(10, Number(process.env.PRIME_MAX_SYMBOLS || 30));
  cachedUniverse = universe.slice(0, maxSymbols);
  cachedAt = now;
  return cachedUniverse;
}
