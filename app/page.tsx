'use client';
import {useEffect,useState} from 'react';
import {formatNumber} from '@/lib/scanner';

type Row={symbol:string;ltp:number;change:number;volumeX:number;ema:string;level:string;setup:string;status:string;entry:number|null;sl:number|null;target:number|null};
const demo:Row[]=[
 {symbol:'RELIANCE',ltp:0,change:0,volumeX:0,ema:'—',level:'—',setup:'—',status:'WAITING',entry:null,sl:null,target:null},
 {symbol:'HDFCBANK',ltp:0,change:0,volumeX:0,ema:'—',level:'—',setup:'—',status:'WAITING',entry:null,sl:null,target:null},
 {symbol:'ICICIBANK',ltp:0,change:0,volumeX:0,ema:'—',level:'—',setup:'—',status:'WAITING',entry:null,sl:null,target:null},
];

export default function Home(){
 const [rows,setRows]=useState<Row[]>(demo); const [loading,setLoading]=useState(false); const [updated,setUpdated]=useState('—');
 async function refresh(){setLoading(true);try{const r=await fetch('/api/market',{cache:'no-store'});const j=await r.json();if(j.status==='success'){setUpdated(new Date().toLocaleTimeString('en-IN'));}}finally{setLoading(false)}}
 useEffect(()=>{refresh();const id=setInterval(refresh,10000);return()=>clearInterval(id)},[]);
 const confirmed=rows.filter(r=>r.status==='CONFIRMED').length; const setups=rows.filter(r=>r.status==='SETUP').length;
 return <main className="shell">
  <header className="topbar"><div className="brand"><div className="brandMark">PT</div><div><div className="title">Prime Technical Live Scanner</div><div className="sub">Upstox-powered intraday decision terminal</div></div></div><div className="actions"><div className="live"><span className="dot"/> LIVE</div><select className="select" defaultValue="5m"><option>5 Minute</option><option>1 Minute</option></select><button className="btn" onClick={refresh}>{loading?'Refreshing…':'Refresh'}</button></div></header>
  <section className="cards"><div className="card"><div className="label">Confirmed</div><div className="value green">{confirmed}</div></div><div className="card"><div className="label">Setups</div><div className="value">{setups}</div></div><div className="card"><div className="label">Universe</div><div className="value">F&O</div></div><div className="card"><div className="label">Last update</div><div className="value" style={{fontSize:18}}>{updated}</div></div></section>
  <section className="panel"><div className="panelHead"><div className="panelTitle">Prime Technical Candidates</div><div className="count">WATCH → SETUP → CONFIRMED</div></div><div className="tableWrap"><table className="table"><thead><tr><th>Stock</th><th>LTP</th><th>Change</th><th>Volume</th><th>20 EMA</th><th>Level</th><th>Setup</th><th>Status</th><th>Entry</th><th>SL</th><th>Target</th></tr></thead><tbody>{rows.map(r=><tr key={r.symbol}><td className="symbol">{r.symbol}</td><td>{formatNumber(r.ltp)}</td><td className={r.change>=0?'green':'red'}>{r.change?`${r.change.toFixed(2)}%`:'—'}</td><td>{r.volumeX?`${r.volumeX.toFixed(1)}X`:'—'}</td><td>{r.ema}</td><td>{r.level}</td><td>{r.setup}</td><td><span className={`pill ${r.status==='CONFIRMED'?'pillGreen':r.status==='SETUP'?'pillAmber':'pillBlue'}`}>{r.status}</span></td><td>{formatNumber(r.entry)}</td><td>{formatNumber(r.sl)}</td><td>{formatNumber(r.target)}</td></tr>)}</tbody></table></div></section>
  <div className="footer">Server-side Upstox token • Auto refresh 10s • Scanner logic will be connected next</div>
 </main>
}
