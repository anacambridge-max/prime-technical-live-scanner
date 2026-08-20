export type ScanRow={symbol:string;ltp:number;change:number;volumeX:number;ema:string;level:string;setup:string;status:string;entry:number|null;sl:number|null;target:number|null};

export function scanRows(rows:ScanRow[]):ScanRow[]{return rows.filter(r=>r.status==='CONFIRMED'||r.status==='SETUP'||r.status==='WATCH');}

export function formatNumber(value:number|null){return value==null?'—':value.toLocaleString('en-IN',{maximumFractionDigits:2});}
