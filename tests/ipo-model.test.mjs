import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const financeCompiled = await build({entryPoints:['src/lib/finance.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const { netPosition, signedBalance } = await import(`data:text/javascript;base64,${Buffer.from(financeCompiled.outputFiles[0].text).toString('base64')}`);

test('Historical custody postings continue to reconcile outside total assets',()=>{
 const base={openingBalanceDate:'2026-01-01',isLiability:false,isActive:true,deletedAt:null};
 const bank={...base,id:'bank',openingBalance:50000};
 const friend={...base,id:'friend',openingBalance:0,ipoCustody:'friend'};
 const proceeds={...base,id:'proceeds',openingBalance:0,ipoCustody:'proceeds'};
 const ledger=[{kind:'transfer',accountId:'bank',toAccountId:'friend',amount:10000,date:'2026-01-02'},
 {kind:'expense',accountId:'friend',amount:6010,date:'2026-01-03'},
 {kind:'income',accountId:'proceeds',amount:2395,date:'2026-01-04'}];
 assert.equal(signedBalance(friend,ledger),3990);assert.equal(signedBalance(proceeds,ledger),2395);
 assert.deepEqual(netPosition([bank,friend,proceeds],ledger),{assets:40000,owed:0,net:40000});
 ledger.push({kind:'transfer',accountId:'proceeds',toAccountId:'bank',amount:2395,date:'2026-01-05'});
 assert.equal(netPosition([bank,friend,proceeds],ledger).assets,42395);
});
