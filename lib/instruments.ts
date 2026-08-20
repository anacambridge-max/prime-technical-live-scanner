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
const NIFTY_500_FILE = 'https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv';

let cachedUniverse: PrimeInstrument[] | null = null;
let cachedAt = 0;

function parseCsvSymbols(csv: string) {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return new Set<string>();

  const headers = lines[0].split(',').map(x => x.trim().replace(/^"|"$/g, '').toLowerCase());
  const symbolIndex = headers.findIndex(x => x === 'symbol');
  if (symbolIndex < 0) throw new Error('Nifty 500 constituent file has no Symbol column');

  const symbols = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
    const symbol = cells[symbolIndex]?.trim();
    if (symbol) symbols.add(symbol.toUpperCase());
  }
  return symbols;
}

export async function getPrimeUniverse(): Promise<PrimeInstrument[]> {
  const now = Date.now();
  if (cachedUniverse && now - cachedAt < 6 * 60 * 60 * 1000) return cachedUniverse;

  const [nseRes, indexRes] = await Promise.all([
    fetch(NSE_FILE, { cache: 'no-store' }),
    fetch(NIFTY_500_FILE, { cache: 'no-store' }),
  ]);

  if (!nseRes.ok) throw new Error(`Unable to download Upstox NSE instruments: ${nseRes.status}`);
  if (!indexRes.ok) throw new Error(`Unable to download Nifty 500 constituents: ${indexRes.status}`);

  const [nseBytes, indexCsv] = await Promise.all([
    nseRes.arrayBuffer(),
    indexRes.text(),
  ]);

  const bytes = Buffer.from(nseBytes);
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes).toString('utf8')
    : bytes.toString('utf8');
  const instruments = JSON.parse(raw) as UpstoxInstrument[];
  const nifty500 = parseCsvSymbols(indexCsv);

  const equities = new Map<string, string>();
  for (const item of instruments) {
    if (
      item.segment === 'NSE_EQ' &&
      item.instrument_type === 'EQ' &&
      item.instrument_key &&
      item.trading_symbol
    ) {
      equities.set(item.trading_symbol.toUpperCase(), item.instrument_key);
    }
  }

  // Nifty 500 is the complete scan universe. F&O stocks are naturally included,
  // while non-F&O Nifty 500 stocks are retained as well.
  const universe = [...nifty500]
    .map(symbol => {
      const instrumentKey = equities.get(symbol);
      return instrumentKey ? { symbol, instrumentKey } : null;
    })
    .filter((item): item is PrimeInstrument => item !== null)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  if (universe.length < 450) {
    throw new Error(`Nifty 500 universe mapping incomplete: only ${universe.length} stocks matched Upstox NSE equities`);
  }

  cachedUniverse = universe;
  cachedAt = now;
  return cachedUniverse;
}
