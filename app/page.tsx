'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatNumber } from '@/lib/scanner';

type Row = {
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

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('—');
  const [universeSize, setUniverseSize] = useState(0);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/market', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok || json.status !== 'success') throw new Error(json.message || 'Scanner request failed');
      setRows(json.rows || []);
      setUniverseSize(json.universeSize || 0);
      setUpdated(new Date(json.updatedAt || Date.now()).toLocaleTimeString('en-IN'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load scanner');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, []);

  const candidates = useMemo(() => rows.filter(r => r.status !== 'NO TRADE'), [rows]);
  const confirmed = rows.filter(r => r.status === 'CONFIRMED').length;
  const setups = rows.filter(r => r.status === 'SETUP').length;
  const watch = rows.filter(r => r.status === 'WATCH').length;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">PT</div>
          <div>
            <div className="title">Prime Technical Live Scanner</div>
            <div className="sub">Nifty 500 universe • F&amp;O included • Upstox • 5-minute intraday</div>
          </div>
        </div>
        <div className="actions">
          <div className="live"><span className="dot" /> LIVE</div>
          <div className="select">5 Minute</div>
          <button className="btn" onClick={refresh} disabled={loading}>{loading ? 'Scanning…' : 'Refresh'}</button>
        </div>
      </header>

      <section className="cards">
        <div className="card"><div className="label">Confirmed</div><div className="value green">{confirmed}</div></div>
        <div className="card"><div className="label">Setups</div><div className="value">{setups}</div></div>
        <div className="card"><div className="label">Watch</div><div className="value">{watch}</div></div>
        <div className="card"><div className="label">Nifty 500 Universe</div><div className="value">{universeSize || '—'}</div></div>
        <div className="card"><div className="label">Last update</div><div className="value" style={{ fontSize: 18 }}>{updated}</div></div>
      </section>

      {error && <div className="panel" style={{ marginBottom: 16, borderColor: '#7f1d1d' }}>
        <div className="panelHead"><div className="panelTitle">Scanner error</div></div>
        <div style={{ padding: 18, color: '#fca5a5' }}>{error}</div>
      </div>}

      <section className="panel">
        <div className="panelHead">
          <div>
            <div className="panelTitle">Prime Technical Candidates</div>
            <div className="sub">Same Prime Technical engine → Level → Reaction → Candle → Volume → 20 EMA → Confirmation</div>
          </div>
          <div className="count">{candidates.length} CANDIDATES</div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Stock</th><th>LTP</th><th>Change</th><th>Volume</th><th>20 EMA</th>
                <th>Level</th><th>Setup</th><th>Status</th><th>Entry</th><th>SL</th><th>Target</th><th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 && !loading ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40 }}>No Prime Technical setup right now.</td></tr>
              ) : candidates.map(r => (
                <tr key={r.symbol}>
                  <td className="symbol">{r.symbol}</td>
                  <td>{formatNumber(r.ltp)}</td>
                  <td className={r.change >= 0 ? 'green' : 'red'}>{r.change.toFixed(2)}%</td>
                  <td>{r.volumeX ? `${r.volumeX.toFixed(1)}X` : '—'}</td>
                  <td>{r.ema}</td>
                  <td>{r.level}</td>
                  <td>{r.setup}</td>
                  <td><span className={`pill ${r.status === 'CONFIRMED' ? 'pillGreen' : r.status === 'SETUP' ? 'pillAmber' : 'pillBlue'}`}>{r.status}</span></td>
                  <td>{formatNumber(r.entry)}</td>
                  <td>{formatNumber(r.sl)}</td>
                  <td>{formatNumber(r.target)}</td>
                  <td style={{ minWidth: 280 }}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="footer">Upstox token server-side • Nifty 500 cash-equity charts • F&amp;O + non-F&amp;O included • 5-minute candles • Auto refresh 60s • No order execution</div>
    </main>
  );
}
