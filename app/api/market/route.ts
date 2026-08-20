import { NextResponse } from 'next/server';
import { getPrimeUniverse } from '@/lib/instruments';
import { scanUniverse } from '@/lib/prime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Prevent overlapping 500-instrument Upstox scans when the browser refreshes.
// A short server-side cache also protects the Upstox API from repeated scans.
let cachedResponse: { updatedAt: string; universeSize: number; rows: Awaited<ReturnType<typeof scanUniverse>> } | null = null;
let inFlight: Promise<Awaited<ReturnType<typeof scanUniverse>>> | null = null;
let inFlightUniverseSize = 0;
let inFlightStartedAt = 0;
const CACHE_MS = 45_000;

export async function GET() {
  try {
    const now = Date.now();

    if (cachedResponse && now - new Date(cachedResponse.updatedAt).getTime() < CACHE_MS) {
      return NextResponse.json({ status: 'success', ...cachedResponse, cached: true });
    }

    if (!inFlight) {
      inFlightStartedAt = now;
      inFlight = (async () => {
        const universe = await getPrimeUniverse();
        inFlightUniverseSize = universe.length;
        return scanUniverse(universe);
      })();
    }

    const rows = await inFlight;
    const universeSize = inFlightUniverseSize;
    const updatedAt = new Date().toISOString();

    cachedResponse = { updatedAt, universeSize, rows };
    inFlight = null;
    inFlightStartedAt = 0;

    return NextResponse.json({ status: 'success', updatedAt, universeSize, rows, cached: false });
  } catch (error) {
    // Never turn a temporary Upstox/rate-limit problem into a fake empty scan.
    // If a previous successful scan exists, return it with a stale flag.
    inFlight = null;
    if (cachedResponse) {
      return NextResponse.json({
        status: 'success',
        ...cachedResponse,
        cached: true,
        stale: true,
        warning: error instanceof Error ? error.message : 'Temporary scanner error',
      });
    }

    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
