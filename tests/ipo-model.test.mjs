import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const financeCompiled = await build({entryPoints:['src/lib/finance.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const { netPosition, signedBalance } = await import(`data:text/javascript;base64,${Buffer.from(financeCompiled.outputFiles[0].text).toString('base64')}`);
const allocationsCompiled = await build({ entryPoints: ['src/lib/ipo-lot-allocations.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { groupIpoLots } = await import(`data:text/javascript;base64,${Buffer.from(allocationsCompiled.outputFiles[0].text).toString('base64')}`);
const summaryCompiled = await build({ entryPoints: ['src/lib/ipo-portfolio-summary.ts'], bundle: true, write: false, format: 'esm', platform: 'node', tsconfig: 'tsconfig.app.json' });
const { ipoPortfolioRange, summarizeIpoPortfolio } = await import(`data:text/javascript;base64,${Buffer.from(summaryCompiled.outputFiles[0].text).toString('base64')}`);

test('one holder selection per lot combines repeated accounts for saving', () => {
 assert.deepEqual(groupIpoLots(3, '', new Map([[0, 'first'], [1, 'second'], [2, 'first']])), [
  { demat_id: 'first', lots: 2 }, { demat_id: 'second', lots: 1 },
 ]);
 assert.deepEqual(groupIpoLots(3, 'first', new Map([[0, ''], [1, 'second'], [3, 'ignored']])), [
  { demat_id: 'first', lots: 1 }, { demat_id: 'second', lots: 1 },
 ]);
});

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

test('IPO totals cover only applications in the selected range and keep losses separate from gains', () => {
 const application = (company, date, result, invested = null) => ({ company, application_date: date, amount: 15000, realized_profit_loss: result, invested_amount: invested });
 const entries = [
  application('Example IPO', '2026-11-01', 550.25, 12000),
  application('Example IPO', '2026-11-10', -150.50, 3000),
  application('Other IPO', '2026-11-05', null),
  application('Earlier IPO', '2026-10-31', 800),
  application('Later IPO', '2026-11-11', -30),
 ];
 const custom = { from: '2026-11-01', to: '2026-11-10' };
 const summary = summarizeIpoPortfolio(entries, ipoPortfolioRange('custom', custom));
 assert.equal(summary.companies.size, 2);
 assert.equal(summary.applicationCount, 3);
 assert.equal(summary.applied, 45000);
 assert.equal(summary.invested, 15000);
 assert.equal(summary.profit, 550.25);
 assert.equal(summary.loss, 150.50);
 assert.equal(summary.netResult, 399.75);
 assert.equal(summary.companies.get('example ipo').resultPaise, 39975);
 assert.equal(summary.companies.get('other ipo').resultPaise, null);
 const date = new Date(2026, 10, 18, 12);
 assert.deepEqual(ipoPortfolioRange('week', custom, date), { from: '2026-11-16', to: '2026-11-18' });
 assert.deepEqual(ipoPortfolioRange('month', custom, date), { from: '2026-11-01', to: '2026-11-18' });
 assert.deepEqual(ipoPortfolioRange('year', custom, date), { from: '2026-01-01', to: '2026-11-18' });
 assert.equal(summarizeIpoPortfolio(entries, ipoPortfolioRange('all', custom, date)).applicationCount, 5);
});
