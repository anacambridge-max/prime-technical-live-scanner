import { NextResponse } from 'next/server';
import { getPrimeUniverse } from '@/lib/instruments';
import { scanUniverse } from '@/lib/prime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let cachedResponse: { updatedAt: string; universeSize: number; rows: Awaited<ReturnType<typeof scanUniverse>> } | null = null;
let inFlight: Promise<Awaited<ReturnType<typeof scanUniverse>>> | null = null;
let inFlightUniverseSize = 0;
const CACHE_MS = 45_000;

function indiaNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

function isMarketSession() {
  const n = indiaNow();
  if (n.weekday === 'Sat' || n.weekday === 'Sun') return false;
  const minutes = n.hour * 60 + n.minute;
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

export async function GET() {
  try {
    if (!isMarketSession()) {
      if (cachedResponse) {
        return NextResponse.json({ status: 'success', ...cachedResponse, cached: true, marketClosed: true });
      }
      return NextResponse.json({ status: 'success', updatedAt: null, universeSize: 0, rows: [], cached: false, marketClosed: true });
    }

    const now = Date.now();
    if (cachedResponse && now - new Date(cachedResponse.updatedAt).getTime() < CACHE_MS) {
      return NextResponse.json({ status: 'success', ...cachedResponse, cached: true, marketClosed: false });
    }

    if (!inFlight) {
      inFlight = (async () => {
        const universe = await getPrimeUniverse();
        inFlightUniverseSize = universe.length;
        return scanUniverse(universe);
      })();
    }

    const rows = await inFlight;
    const universeSize = inFlightUniverseSize;
    if (!rows.length) throw new Error('Upstox returned no usable 5-minute candles. Last successful scan was retained.');

    const updatedAt = new Date().toISOString();
    cachedResponse = { updatedAt, universeSize, rows };
    inFlight = null;
    return NextResponse.json({ status: 'success', updatedAt, universeSize, rows, cached: false, marketClosed: false });
  } catch (error) {
    inFlight = null;
    if (cachedResponse) {
      return NextResponse.json({ status: 'success', ...cachedResponse, cached: true, stale: true, marketClosed: false, warning: error instanceof Error ? error.message : 'Temporary scanner error' });
    }
    return NextResponse.json({ status: 'error', message: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
