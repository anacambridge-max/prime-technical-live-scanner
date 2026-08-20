import { NextResponse } from 'next/server';
import { getOHLC } from '@/lib/upstox';

export async function GET(){
  try{
    const raw=process.env.PRIME_INSTRUMENT_KEYS||'';
    const keys=raw.split(',').map(s=>s.trim()).filter(Boolean);
    if(!keys.length) return NextResponse.json({status:'needs_config',message:'Add PRIME_INSTRUMENT_KEYS with Upstox instrument keys.'});
    const data=await getOHLC(keys,'I1');
    return NextResponse.json({status:'success',data});
  }catch(error){
    return NextResponse.json({status:'error',message:error instanceof Error?error.message:'Unknown error'},{status:500});
  }
}
