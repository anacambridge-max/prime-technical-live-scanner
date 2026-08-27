'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatNumber } from '@/lib/scanner';

type Row = {
  symbol: string; ltp: number; change: number; volumeX: number; ema: string; level: string; setup: string;
  status: 'WATCH' | 'SETUP' | 'CONFIRMED' | 'NO TRADE'; entry: number | null; sl: number | null; target: number | null;
  reason: string; signalTime: string | null;
};

type ApiState = { marketClosed?: boolean; stale?: boolean; warning?: string };

const statusRank: Record<Row['status'], number> = { CONFIRMED: 0, SETUP: 1, WATCH: 2, 'NO TRADE': 9 };

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [updated, setUpdated] = useState('—');
  const [universeSize, setUniverseSize] = useState(0);
  const [marketClosed, setMarketClosed] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [directionFilter, setDirectionFilter] = useState('ALL');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [volumeFilter, setVolumeFilter] = useState(0);

  async function refresh() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/market', { cache: 'no-store' });
      const json: ApiState & { status: string; rows?: Row[]; universeSize?: number; updatedAt?: string | null; message?: string } = await response.json();
      if (json.status !== 'success') throw new Error(json.message || 'Scanner request failed');
      setRows(json.rows || []); setUniverseSize(json.universeSize || 0);
      setMarketClosed(Boolean(json.marketClosed)); setWarning(json.warning || (json.stale ? 'Showing the last successful scan.' : ''));
      setUpdated(json.updatedAt ? new Date(json.updatedAt).toLocaleTimeString('en-IN') : '—');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load scanner'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, []);

  const candidates = useMemo(() => rows
    .filter(r => r.status !== 'NO TRADE')
    .filter(r => statusFilter === 'ALL' || r.status === statusFilter)
    .filter(r => directionFilter === 'ALL' || (directionFilter === 'BUY' ? r.setup.includes('BUY') : r.setup.includes('SELL')))
    .filter(r => levelFilter === 'ALL' || r.level === levelFilter)
    .filter(r => !volumeFilter || r.volumeX >= volumeFilter)
    .sort((a, b) => statusRank[a.status] - statusRank[b.status] || b.volumeX - a.volumeX), [rows, statusFilter, directionFilter, levelFilter, volumeFilter]);

  const confirmed = rows.filter(r => r.status === 'CONFIRMED').length;
  const setups = rows.filter(r => r.status === 'SETUP').length;
  const watch = rows.filter(r => r.status === 'WATCH').length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><div className="brandMark">PT</div><div><div className="title">Prime Technical Live Scanner</div><div className="sub">Nifty 500 universe • F&amp;O included • Upstox • 5-minute intraday</div></div></div>
        <div className="actions"><div className={marketClosed ? 'live closed' : 'live'}><span className="dot" /> {marketClosed ? 'MARKET CLOSED' : 'LIVE'}</div><div className="select">5 Minute</div><button className="btn" onClick={refresh} disabled={loading || marketClosed}>{loading ? 'Scanning…' : marketClosed ? 'Closed' : 'Refresh'}</button></div>
      </header>

      <section className="cards">
        <div className="card"><div className="label">Confirmed</div><div className="value green">{confirmed}</div></div>
        <div className="card"><div className="label">Setups</div><div className="value">{setups}</div></div>
        <div className="card"><div className="label">Watch</div><div className="value">{watch}</div></div>
        <div className="card"><div className="label">Nifty 500 Universe</div><div className="value">{universeSize || '—'}</div></div>
        <div className="card"><div className="label">Last update</div><div className="value" style={{ fontSize: 18 }}>{updated}</div></div>
      </section>

      {(error || warning || marketClosed) && <div className="panel" style={{ marginBottom: 16, borderColor: error ? '#7f1d1d' : '#334155' }}><div style={{ padding: 14, color: error ? '#fca5a5' : '#cbd5e1' }}>{error || warning || 'NSE session is closed. No fresh intraday confirmations are generated.'}</div></div>}

      <section className="panel">
        <div className="panelHead"><div><div className="panelTitle">Prime Technical Candidates</div><div className="sub">Level → Reaction → Candle → Volume → 20 EMA → Confirmation</div></div><div className="count">{candidates.length} CANDIDATES</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid rgba(148,163,184,.12)' }}>
          <select className="filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="ALL">All status</option><option value="CONFIRMED">Confirmed</option><option value="SETUP">Setup</option><option value="WATCH">Watch</option></select>
          <select className="filter" value={directionFilter} onChange={e => setDirectionFilter(e.target.value)}><option value="ALL">All direction</option><option value="BUY">Buy</option><option value="SELL">Sell</option></select>
          <select className="filter" value={levelFilter} onChange={e => setLevelFilter(e.target.value)}><option value="ALL">All levels</option><option value="PDH">PDH</option><option value="PDL">PDL</option></select>
          <select className="filter" value={volumeFilter} onChange={e => setVolumeFilter(Number(e.target.value))}><option value="0">Any volume</option><option value="1.5">≥1.5x</option><option value="2">≥2x</option><option value="4">≥4x</option><option value="6">≥6x</option></select>
        </div>
        <div className="tableWrap"><table className="table"><thead><tr><th>Stock</th><th>LTP</th><th>Change</th><th>Volume</th><th>20 EMA</th><th>Level</th><th>Setup</th><th>Status</th><th>Entry</th><th>SL</th><th>Target</th><th>Reason</th></tr></thead>
          <tbody>{candidates.length === 0 && !loading ? <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40 }}>No matching Prime Technical setup.</td></tr> : candidates.map(r => <tr key={r.symbol}><td className="symbol">{r.symbol}</td><td>{formatNumber(r.ltp)}</td><td className={r.change >= 0 ? 'green' : 'red'}>{r.change.toFixed(2)}%</td><td>{r.volumeX ? `${r.volumeX.toFixed(1)}X` : '—'}</td><td>{r.ema}</td><td>{r.level}</td><td>{r.setup}</td><td><span className={`pill ${r.status === 'CONFIRMED' ? 'pillGreen' : r.status === 'SETUP' ? 'pillAmber' : 'pillBlue'}`}>{r.status}</span></td><td>{formatNumber(r.entry)}</td><td>{formatNumber(r.sl)}</td><td>{formatNumber(r.target)}</td><td style={{ minWidth: 320, maxWidth: 520, whiteSpace: 'normal', lineHeight: 1.4 }}>{r.reason}</td></tr>)}</tbody>
        </table></div>
      </section>
      <div className="footer">NSE 09:15–15:30 IST • Server-side Upstox token • 5-minute completed candles • Auto refresh 60s • No order execution</div>
    </main>
  );
}
