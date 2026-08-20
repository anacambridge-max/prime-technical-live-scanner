import { NextResponse } from 'next/server';
import { getPrimeUniverse } from '@/lib/instruments';
import { scanUniverse } from '@/lib/prime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const universe = await getPrimeUniverse();
    const rows = await scanUniverse(universe);

    return NextResponse.json({
      status: 'success',
      updatedAt: new Date().toISOString(),
      universeSize: universe.length,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
