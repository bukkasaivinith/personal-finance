import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({entryPoints:['src/lib/ipo.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const { indexIpo,filterIpo,summaryIpo,emptyFilters,ipoCalendar,ipoCsv,ipoLotsResult,ipoApplicationLots,ipoDateKey,ipoPortfolioRange,ipoPortfolioSummary } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const financeCompiled = await build({entryPoints:['src/lib/finance.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const { netPosition, signedBalance } = await import(`data:text/javascript;base64,${Buffer.from(financeCompiled.outputFiles[0].text).toString('base64')}`);
const data={applicants:[{id:'p',name:'Renamed person'}],applicant_accounts:[{id:'d',applicant_id:'p',nickname:'First demat'},{id:'d2',applicant_id:'p',nickname:'Second demat'}],companies:[{id:'c',name:'Company',classification:'SME',dates:{expected_allotment:'2026-02-10',actual_listing:'2026-02-14'}}],applications:[{id:'a',company_id:'c',applicant_account_id:'d',application_date:'2026-02-01',amount:10000,funding_method:'friend',status:'partial',blocked:4000,refund_due:0,reference:''},{id:'b',company_id:'c',applicant_account_id:'d2',application_date:'2026-02-02',amount:10000,funding_method:'friend',status:'none',blocked:0,refund_due:0,reference:''}],allotments:[{application_id:'a',shares:60,cost:6010,voided:false},{application_id:'b',shares:0,cost:0,result:'none',voided:false}],sales:[{id:'s',application_id:'a',shares:20,cost_basis:2003.33,net:2395,profit:391.67,voided:false},{id:'reversed-sale',application_id:'a',shares:40,cost_basis:4006.67,net:0,profit:-4006.67,voided:true}],settlements:[{applicant_id:'p',kind:'funding',amount:20000,voided:false},{applicant_id:'p',sale_id:'s',kind:'receipt',amount:1000,voided:false},{applicant_id:'p',kind:'repayment',amount:500,voided:false},{applicant_id:'p',kind:'repayment',amount:2000,voided:true}],events:[{id:'e',command:'application',application_id:'a',company_id:'c',applicant_id:'p',event_date:'2026-02-01',amount:10000,expected:false,reversed:false,details:{},payload:{}},{id:'old',command:'sale',event_date:'2026-02-02',reversed:true,details:{},payload:{}}],cash_accounts:[]};
test('holding cost, sale profit and pooled custody reconcile across multiple demats',()=>{
 const indexed=indexIpo(data),s=summaryIpo(indexed.rows);
 assert.equal(s.applications,2);assert.equal(s.companies,1);assert.equal(s.applied,20000);assert.equal(s.allotted,1);assert.equal(s.unsuccessful,1);
 assert.equal(s.shares,40);assert.equal(s.invested,4006.67);assert.equal(s.profit,391.67);assert.equal(s.unsettled,1395);assert.equal(s.blocked,4000);
 assert.equal(indexed.friendBalances.get('p'),14490);assert.equal(indexed.rows[0].label,'Renamed person / First demat');
});
test('combined filters and custom date ranges keep only matching records',()=>{
 const i=indexIpo(data);
 const matches=filterIpo(i.rows,{...emptyFilters,search:'company',applicant:'p',classification:'SME',funding:'friend',start:'2026-02-01',end:'2026-02-01',holding:'open'},i.friendBalances);
 assert.deepEqual(matches.map(x=>x.id),['a']);
 assert.equal(filterIpo(i.rows,{...emptyFilters,holding:'sold'},i.friendBalances).length,0);
 assert.equal(filterIpo(i.rows,{...emptyFilters,search:'other'},i.friendBalances).length,0);
});
test('calendar shows only current applications, actual results and one listing per company',()=>{
 const fixture = {
  ...data,
  companies: [{ ...data.companies[0], dates: { opening:'2026-01-31', closing:'2026-02-03', expected_allotment:'2026-02-10', actual_allotment:'2026-02-12', actual_refund:'2026-02-13', actual_listing:'2026-02-14' } }],
  applications: [{ ...data.applications[0], application_date:'2026-02-03' }, data.applications[1]],
  allotments: [{ ...data.allotments[0], allotted_on:'2026-02-12' }, { ...data.allotments[1], allotted_on:'2026-02-12', voided:true }],
  events: [
   ...data.events,
   { company_id:'c', command:'block', event_date:'2026-02-03' },
   { company_id:'c', command:'event', details:{kind:'listing'}, event_date:'2026-02-14' },
   { company_id:'c', command:'event', details:{kind:'listing'}, event_date:'2026-02-18', expected:true },
  ],
 };
 assert.deepEqual(ipoCalendar(fixture).map(event=>[event.label,event.date]),[
  ['Applied','2026-02-02'], ['Applied','2026-02-03'], ['Allotment','2026-02-12'], ['Listing','2026-02-14'],
 ]);
});
test('allotted and non-allotted lots must reconcile before conversion to shares',()=>{
 const application = { lots:3, lot_size:55 };
 assert.deepEqual(ipoLotsResult(application,3,0),{ shares:165,result:'full' });
 assert.deepEqual(ipoLotsResult(application,1,2),{ shares:55,result:'partial' });
 assert.deepEqual(ipoLotsResult(application,0,3),{ shares:0,result:'none' });
 for (const [allotted, notAllotted] of [[2,0],[3,1],[-1,4],[1.5,1.5],[NaN,3]]) {
  assert.equal(ipoLotsResult(application,allotted,notAllotted),null);
 }
});
test('empty portfolio has no invented values',()=>{
 const blank=Object.fromEntries(Object.keys(data).map(k=>[k,[]]));const i=indexIpo(blank);
 assert.equal(summaryIpo(i.rows).profit,0);assert.equal(i.friendBalances.size,0);assert.deepEqual(ipoCalendar(blank),[]);
});
test('IPO funds remain visible in their own accounts but stay outside total assets',()=>{
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
test('CSV quotes text, protects formula injection and preserves numeric losses',()=>{
 const csv=ipoCsv([['=CMD()', '\t+formula', '@SUM(1)', '-text','quoted "name"','two\nlines',-12.5,0]]);
 assert.ok(csv.includes('"\'=CMD()"'));assert.ok(csv.includes('"\'\t+formula"'));assert.ok(csv.includes('"\'@SUM(1)"'));assert.ok(csv.includes('"\'-text"'));assert.ok(csv.includes('"quoted ""name"""'));assert.ok(csv.includes('"two\nlines"'));assert.ok(csv.includes('"-12.5"'));assert.ok(csv.includes('"0"'));
});
test('portfolio periods use submission, result and sale dates independently', () => {
 const { rows } = indexIpo({
  ...data,
  allotments: [
   { ...data.allotments[0], result: 'partial', allotted_on: '2026-02-16' },
   { ...data.allotments[1], allotted_on: '2026-02-18' },
  ],
  sales: [
   { ...data.sales[0], sold_on: '2026-02-16' },
   { ...data.sales[1], sold_on: '2026-02-16' },
   { ...data.sales[0], id: 'loss', sold_on: '2026-02-18', profit: -100 },
   { ...data.sales[0], id: 'old', sold_on: '2026-01-31', profit: 20 },
  ],
 });
 const week = ipoPortfolioRange('week', '2026-02-19', {});
 assert.deepEqual(week, { start: '2026-02-16', end: '2026-02-19' });
 assert.deepEqual(ipoPortfolioSummary(rows, week), {
  companies: 0, applications: 0, allotted: 1, notAllotted: 1, profit: 391.67, loss: 100, net: 291.67,
 });
 const month = ipoPortfolioRange('month', '2026-02-19', {});
 assert.deepEqual(ipoPortfolioSummary(rows, month), {
  companies: 1, applications: 2, allotted: 1, notAllotted: 1, profit: 391.67, loss: 100, net: 291.67,
 });
 const custom = { start: '2026-02-18', end: '2026-02-18' };
 assert.equal(ipoPortfolioSummary(rows, ipoPortfolioRange('custom', '2026-02-19', custom)).net, -100);
 assert.equal(ipoDateKey(new Date('2026-02-18T20:00:00Z')), '2026-02-19');
});

test('each applied amount must buy whole lots at the exact issue price', () => {
 assert.equal(ipoApplicationLots('299.97', '33.33', '3', '1'), 3);
 assert.equal(ipoApplicationLots('15000', '100', '50', '1'), 3);
 assert.equal(ipoApplicationLots('299.98', '33.33', '3', '1'), null);
 assert.equal(ipoApplicationLots('299.97', '33.33', '3', '4'), null);
 assert.equal(ipoApplicationLots('', '0', '3', '1'), null);
});
