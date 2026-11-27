import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('IPO accounting on the complete application migration history', async (t) => {
 const db = new PGlite({ extensions: { pgcrypto } });
 t.after(() => db.close());
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now(),email_confirmed_at timestamptz DEFAULT now(),raw_user_meta_data jsonb DEFAULT '{}');
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),refreshed_at timestamptz,not_after timestamptz,user_agent text);
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
 `);
 const directory = new URL('../supabase/migrations/', import.meta.url);
 const ownerMigration = '20261123100000_single_owner_workspace.sql';
 const disableIpoMigration = '20261123120000_disable_ipo_feature.sql';
 const portfolioMigration = '20261123130000_ipo_portfolio_applications.sql';
 const dematLotsMigration = '20261123140000_ipo_demat_accounts_and_lots.sql';
 const editDematMigration = '20261123150000_ipo_demat_edit_and_broker_apps.sql';
 const manageApplicationsMigration = '20261123160000_manage_ipo_applications.sql';
 const allotmentDateMigration = '20261123180000_ipo_allotment_date.sql';
 const savingsMigration = '20261123190000_savings_entries.sql';
 const ipoResultsMigration = '20261123200000_ipo_realized_results.sql';
 const savingsHistoryMigration = '20261123210000_savings_account_history.sql';
 const ipoPresentValueMigration = '20261123220000_ipo_present_total_value.sql';
 const ipoNotAllottedMigration = '20261124100000_ipo_not_allotted.sql';
 const financeReadsMigration = '20261124110000_scope_finance_reads.sql';
 const savingsEmojiMigration = '20261126120000_savings_account_emojis.sql';
 const standardTypesMigration = '20261127150000_standard_transaction_types.sql';
 for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
  if ([ownerMigration, disableIpoMigration, portfolioMigration, dematLotsMigration, editDematMigration, manageApplicationsMigration,
   allotmentDateMigration, savingsMigration, ipoResultsMigration, savingsHistoryMigration, ipoPresentValueMigration, ipoNotAllottedMigration,
   financeReadsMigration, savingsEmojiMigration, standardTypesMigration].includes(name)) continue; // Test each upgrade with existing data.
  try { await db.exec(await readFile(new URL(name, directory), 'utf8')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
 }
 const owner=randomUUID(), other=randomUUID(), session=randomUUID();
 await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4)',[owner,'bukkasaivinith@gmail.com',other,'ipo-other@example.test']);
 await db.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[session,owner]);
 await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session})]);
 await db.exec('SELECT public.activate_current_single_device_session(); SET ROLE authenticated;');
 const command=async (name,data,key=randomUUID()) => (await db.query('SELECT public.ipo_command($1,$2,$3) AS r',[key,name,JSON.stringify(data)])).rows[0].r;
 const scalar=async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
 const bank=await scalar("INSERT INTO public.accounts(user_id,name,opening_balance,opening_balance_date,is_liability) VALUES(auth.uid(),'Bank',100000,'2026-01-01',false) RETURNING id");
 const person=(await command('applicant',{name:'Rahul',designation:'friend'})).id;
 const demat=(await command('demat',{applicant_id:person,nickname:'Rahul / One'})).id;
 const company=(await command('company',{name:'Example IPO',classification:'Mainboard',issue_price:100,lot_size:100,minimum_lots:1})).id;
 const createApp=async (method='direct',extras={}) => (await command('application',{company_id:company,applicant_account_id:demat,date:'2026-01-02',lots:1,lot_size:100,issue_price:100,funding_method:method,account_id:bank,...extras})).id;
 const row=async (table,id) => (await db.query(`SELECT * FROM public.${table} WHERE id=$1`,[id])).rows[0];
 const ledger=async account => Number(await scalar("SELECT COALESCE(sum(CASE WHEN transaction_kind='expense' AND account_id=$1 THEN -amount WHEN transaction_kind='income' AND account_id=$1 THEN amount WHEN transaction_kind='transfer' THEN CASE WHEN account_id=$1 THEN -amount ELSE amount END ELSE 0 END),0) FROM public.transactions WHERE account_id=$1 OR to_account_id=$1",[account]));
 let application;
 await t.test('application and block are memo records, never bank debits',async()=>{
  application=await createApp(); await command('block',{application_id:application,date:'2026-01-02',amount:10000});
  assert.equal(await ledger(bank),0); assert.equal(Number((await row('ipo_applications',application)).blocked),10000);
 });
 let investment;
 await t.test('partial allotment posts exactly one debit and one linked investment',async()=>{
  const input={application_id:application,date:'2026-01-03',shares:60,purchase_charges:10,result:'partial'}, key=randomUUID();
  const [a,b]=await Promise.all([command('allot',input,key),command('allot',input,key)]); assert.deepEqual(a,b);
  assert.equal(await ledger(bank),-6010); investment=await scalar('SELECT investment_id FROM public.ipo_allotments WHERE application_id=$1',[application]);
  assert.equal(Number((await row('investments',investment)).principal_amount),6010);
  await assert.rejects(command('allot',input),/already has/);
  await assert.rejects(command('allot',{...input,shares:20},key),/different details/);
  await command('unblock',{application_id:application,date:'2026-01-03',amount:4000}); assert.equal(await ledger(bank),-6010);
  await assert.rejects(command('refund',{application_id:application,date:'2026-01-03',amount:4000,account_id:bank}),/prepaid/);
 });
 let firstSale,secondSale;
 await t.test('partial and final sales allocate charges exactly and realise only sale profits',async()=>{
  firstSale=(await command('sale',{application_id:application,date:'2026-01-04',shares:20,price:120,charges:5})).id;
  let s=await row('ipo_sales',firstSale); assert.equal(Number(s.cost_basis),2003.33); assert.equal(Number(s.profit),391.67);
  assert.equal((await row('investments',investment)).status,'active'); assert.equal(await ledger(bank),-6010);
  const balances=await scalar('SELECT public.ipo_finance_links($1)',[owner]);
  assert.equal(Number(balances.balances.invested),4006.67);assert.equal(Number(balances.balances.awaiting_receipt),2395);
  secondSale=(await command('sale',{application_id:application,date:'2026-01-05',shares:40,price:80,charges:5})).id;
  s=await row('ipo_sales',secondSale); assert.equal(Number(s.cost_basis),4006.67); assert.equal(Number(s.profit),-811.67);
  const i=await row('investments',investment); assert.equal(i.status,'settled'); assert.equal(Number(i.final_amount),5590); assert.equal(Number(i.profit_amount),-420);
  await assert.rejects(command('sale',{application_id:application,date:'2026-01-05',shares:1,price:100}),/remaining shares/);
 });
 await t.test('proceeds received by friend and partial repayments do not realise profit twice',async()=>{
  await command('receipt',{sale_id:firstSale,date:'2026-01-06',amount:2395,destination:'friend'});
  await command('repay',{applicant_id:person,account_id:bank,date:'2026-01-07',amount:1000});
  assert.equal(await ledger(bank),-5010); assert.equal(Number((await row('investments',investment)).profit_amount),-420);
  await assert.rejects(command('receipt',{sale_id:firstSale,date:'2026-01-07',amount:1,destination:'bank',account_id:bank}),/exceeds/);
  await assert.rejects(command('repay',{applicant_id:person,account_id:bank,date:'2026-01-07',amount:2000}),/exceeds/);
  await command('receipt',{sale_id:secondSale,date:'2026-01-07',amount:3195,destination:'bank',account_id:bank});
  assert.equal(await ledger(bank),-1815);
 });
 await t.test('pooled friend funding can fund multiple applications without duplicate outflows',async()=>{
  await command('fund_friend',{applicant_id:person,account_id:bank,company_id:company,date:'2026-01-08',amount:20000});
  const a=await createApp('friend'), b=await createApp('friend');
  await command('block',{application_id:a,date:'2026-01-08',amount:10000}); await command('block',{application_id:b,date:'2026-01-08',amount:10000});
  const before=await ledger(bank);
  await command('allot',{application_id:a,date:'2026-01-09',shares:100,result:'full'});
  await command('allot',{application_id:b,date:'2026-01-09',shares:0,result:'none'});
  assert.equal(await ledger(bank),before);
  await command('unblock',{application_id:b,date:'2026-01-09',amount:10000});
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_allotments WHERE investment_id IS NOT NULL AND NOT voided')),2);
 });
 await t.test('actual prepayment refunds, correction history and rollback',async()=>{
  const a=await createApp(); const before=await ledger(bank);
  await command('prepay',{application_id:a,date:'2026-01-10',amount:10000});
  await command('allot',{application_id:a,date:'2026-01-11',shares:0,result:'rejected'});
  const refund=await command('refund',{application_id:a,date:'2026-01-12',amount:8000,account_id:bank});
  assert.equal(await ledger(bank),before-2000);
  await command('reverse',{event_id:refund.event_id,date:'2026-01-12',reason:'Incorrect amount'});
  assert.equal(await ledger(bank),before-10000); assert.equal(Number((await row('ipo_applications',a)).refund_due),10000);
  await command('refund',{application_id:a,date:'2026-01-12',amount:10000,account_id:bank}); assert.equal(await ledger(bank),before);
  const count=await scalar('SELECT count(*) FROM public.ipo_events');
  await assert.rejects(command('allot',{application_id:randomUUID(),date:'2026-01-13',shares:50,result:'partial'}),/unavailable/);
  assert.equal(await scalar('SELECT count(*) FROM public.ipo_events'),count);
 });
 await t.test('ownership, backend write protection, session expiry and private reads',async()=>{
  const links=await scalar('SELECT public.ipo_finance_links($1)',[owner]);
  assert.equal(Number(links.balances.invested),10000);assert.equal(Number(links.balances.applicant_custody),11395);
  assert.ok(links.investments.some(i=>i.id===investment));assert.ok(links.memos.some(m=>m.application_id===application));
  const dashboard=await scalar('SELECT public.ipo_dashboard()');assert.equal(dashboard.companies.length,1);
  await db.query("SELECT set_config('ipo.write','on',false)");
  await assert.rejects(db.query("UPDATE public.transactions SET amount=1 WHERE investment_id=$1",[investment]),/managed by IPO/);
  await assert.rejects(db.query('SELECT public.delete_investment($1)',[investment]),/managed by IPO/);
  await assert.rejects(db.query('INSERT INTO public.ipo_write_context VALUES(txid_current(),auth.uid())'),/permission denied/);
  await db.query("SELECT set_config('ipo.write','',false)");
  await assert.rejects(db.query('SELECT public.delete_investment($1)',[investment]),/managed by IPO/);
  await assert.rejects(command('company',{name:'Invalid price',classification:'Mainboard',issue_price:'NaN',lot_size:1,minimum_lots:1}),/finite/);
  await db.query("UPDATE public.accounts SET name='Renamed bank' WHERE id=$1",[bank]);
  await command('applicant',{id:person,name:'Renamed applicant',designation:'friend',archived:true});
  const updated=await scalar('SELECT public.ipo_finance_links($1)',[owner]);assert.ok(updated.investments.some(i=>i.name.includes('Renamed applicant')));
  const custody=await scalar("SELECT account_id FROM public.ipo_cash_accounts WHERE applicant_id=$1",[person]);
  assert.ok((await row('accounts',custody)).name.includes('Renamed applic'));
  await assert.rejects(db.query('SELECT public.record_investment_withdrawal($1,1,$2)',[updated.investments.find(i=>!i.voided&&i.remaining_shares>0).id,'2026-01-14']),/managed by IPO/);
  await assert.rejects(db.query("INSERT INTO public.ipo_applicants(user_id,name,designation) VALUES($1,'Bypass','self')",[owner]),/permission denied/);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:other,session_id:session})]);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_applications')),0);
  await assert.rejects(command('applicant',{name:'No session',designation:'self'}),/session/);
  await db.exec('RESET ROLE');
  await db.query("INSERT INTO public.workspace_members(owner_id,member_id,role) VALUES($1,$2,'editor')",[owner,other]);
  await db.query("INSERT INTO public.account_shares(account_id,owner_id,member_id,role) VALUES($1,$2,$3,'editor')",[bank,owner,other]);
  await assert.rejects(db.query("INSERT INTO public.account_shares(account_id,owner_id,member_id,role) VALUES($1,$2,$3,'editor')",[custody,owner,other]),/managed by IPO/);
  await db.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[randomUUID(),other]);
  const otherSession=await scalar('SELECT id FROM auth.sessions WHERE user_id=$1',[other]);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:other,session_id:otherSession})]);
  await db.exec('SELECT public.activate_current_single_device_session(); SET ROLE authenticated;');
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_events')),0);
  await assert.rejects(command('block',{application_id:application,date:'2026-01-02',amount:1}),/unavailable/);
  assert.deepEqual(await scalar('SELECT public.ipo_finance_links($1)',[owner]),{});
  await db.exec('RESET ROLE');await db.query('INSERT INTO public.platform_administrators(user_id) VALUES($1)',[other]);await db.exec('SET ROLE authenticated');
  await assert.rejects(scalar('SELECT public.ipo_dashboard()'),/private owner workspace/);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_applicants')),0);
 });
 await t.test('backdated custody movements and pre-opening bank entries roll back',async()=>{
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session})]);
  const p=(await command('applicant',{name:'Date check',designation:'friend'})).id;
  await command('fund_friend',{applicant_id:p,account_id:bank,date:'2026-01-20',amount:100});
  const before=await ledger(bank);
  await assert.rejects(command('repay',{applicant_id:p,account_id:bank,date:'2026-01-19',amount:50}),/negative/);
  await assert.rejects(command('fund_friend',{applicant_id:p,account_id:bank,date:'2025-12-31',amount:50}),/opening balance date/);
  assert.equal(await ledger(bank),before);
 });
 await t.test('application correction, audit history and one-to-one requests',async()=>{
  await command('company',{id:company,name:'Example IPO',classification:'Mainboard',issue_price:100,lot_size:100,minimum_lots:1,dates:{actual_allotment:'2026-01-03',actual_listing:'2026-01-04'}});
  assert.equal((await row('ipo_companies',company)).dates.actual_allotment,'2026-01-03');
  await assert.rejects(command('company',{name:'Bad dates',classification:'SME',issue_price:1,lot_size:1,minimum_lots:1,dates:{opening:'2026-02-01',closing:'2026-01-01'}}),/Closing date/);
  const p=(await command('applicant',{name:'Correction',designation:'self'})).id;
  const da=(await command('demat',{applicant_id:p,nickname:'Another demat'})).id;
  const a=await createApp('direct',{applicant_account_id:da});
  await command('edit_application',{application_id:a,company_id:company,applicant_account_id:da,date:'2026-01-02',lots:2,lot_size:100,issue_price:100,adjustment:-10,adjustment_reason:'Recorded discount',funding_method:'direct',account_id:bank});
  assert.equal(Number((await row('ipo_applications',a)).amount),19990);
  await command('block',{application_id:a,date:'2026-01-02',amount:100});
  await assert.rejects(command('edit_application',{application_id:a,company_id:company,applicant_account_id:da,date:'2026-01-02',lots:1,lot_size:100,issue_price:100,funding_method:'direct',account_id:bank}),/Release funds/);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.audit_events WHERE entity_table='ipo_events'")),Number(await scalar('SELECT count(*) FROM public.ipo_events')));
  await db.exec('RESET ROLE');assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_write_context')),0);await db.exec('SET ROLE authenticated');
 });
 await t.test('ordinary investment workflow and corrections remain independent',async()=>{
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session})]);
  const profile=(await command('applicant',{name:'Self',designation:'self'})).id;
  const account=(await command('demat',{applicant_id:profile,nickname:'Personal'})).id;
  const a=await createApp('direct',{applicant_account_id:account,lot_size:3,issue_price:33.33});
  const allot=await command('allot',{application_id:a,shares:3,result:'full',purchase_charges:0.01,date:'2026-01-13'});
  const sale=await command('sale',{application_id:a,shares:3,price:0,charges:0,date:'2026-01-14'});
  const zero=await scalar('SELECT profit FROM public.ipo_sales WHERE id=$1',[sale.id]);assert.equal(Number(zero),-100);
  await command('reverse',{event_id:sale.event_id,reason:'Wrong sale',date:'2026-01-14'});
  await command('reverse',{event_id:allot.event_id,reason:'Wrong allotment',date:'2026-01-14'});
  const before=await scalar('SELECT count(*) FROM public.investments');
  await command('allot',{application_id:a,shares:0,result:'cancelled',date:'2026-01-14'});
  assert.equal(await scalar('SELECT count(*) FROM public.investments'),before);
  const type=await scalar("SELECT public.create_investment_type('Private')");
  const ordinary=await scalar('SELECT public.record_investment($1,$2,$3,$4,$5,$6)',['Business',type,'',bank,500,'2026-01-15']);
  assert.equal(Number((await row('investments',ordinary)).principal_amount),500);
  await db.query('SELECT public.record_investment_withdrawal($1,$2,$3)',[ordinary,100,'2026-01-16']);
  await db.query('SELECT public.settle_investment($1,$2,$3)',[ordinary,500,'2026-01-17']);
  assert.equal(Number((await row('investments',ordinary)).profit_amount),100);
 });
 await t.test('manual verification queries run against the complete schema',async()=>{
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL('../docs/IPO-VERIFY.sql',import.meta.url),'utf8'));
  await db.exec('SET ROLE authenticated');
 });
 await t.test('single-owner upgrade preserves records and blocks existing shared and admin sessions',async()=>{
  const migration = await readFile(new URL(ownerMigration, directory), 'utf8');
  await db.exec('RESET ROLE');
  const otherSession = await scalar('SELECT id FROM auth.sessions WHERE user_id=$1',[other]);
  const originalBalance = await ledger(bank);
  const originalEventCount = await scalar('SELECT count(*) FROM public.ipo_events');
  const originalShares = await scalar('SELECT count(*) FROM public.account_shares');
  await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[owner]);
  await assert.rejects(db.exec(migration),/Expected one active, verified account/);
  await db.exec('ROLLBACK');
  assert.equal(await scalar("SELECT to_regclass('public.finance_workspace_owner')"),null);
  await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[owner]);
  await db.exec(migration);
  assert.equal(Number(await scalar('SELECT count(*) FROM auth.users')),2);
  assert.equal(await scalar('SELECT count(*) FROM public.account_shares'),originalShares);
  assert.equal(await scalar('SELECT count(*) FROM public.ipo_events'),originalEventCount);

  await db.exec('SET ROLE authenticated');
  assert.equal(await scalar('SELECT public.is_finance_workspace_owner()'),true);
  await db.exec('SELECT public.activate_current_single_device_session(); SELECT public.open_finance_workspace();');
  assert.equal(await scalar('SELECT id FROM public.get_current_finance_profile()'),owner);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.list_accessible_workspaces()')),1);
  assert.equal(await ledger(bank),originalBalance);
  assert.equal((await scalar('SELECT public.ipo_dashboard()')).companies.length,1);
  await assert.rejects(scalar('SELECT account_id FROM public.account_shares'),/permission denied/);
  await assert.rejects(scalar('SELECT public.get_workspace_sharing($1)',[owner]),/permission denied/);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:other,session_id:otherSession,email:'bukkasaivinith@gmail.com'})]);
  assert.equal(await scalar('SELECT public.is_finance_workspace_owner()'),false);
  assert.equal(await scalar('SELECT public.is_platform_admin()'),false);
  assert.equal(await scalar('SELECT public.validate_current_single_device_session()'),false);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.accounts')),0);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.get_current_finance_profile()')),0);
  await assert.rejects(scalar('SELECT public.activate_current_single_device_session()'),/only to its owner/);
  await assert.rejects(scalar('SELECT * FROM public.get_workspace_transactions($1)',[owner]),/unavailable/);
  await assert.rejects(scalar('SELECT public.ipo_dashboard()'),/session/);
  await assert.rejects(scalar('SELECT public.athlete_get_dashboard()'),/session/);
  await assert.rejects(scalar('SELECT * FROM public.list_platform_users()'),/permission denied/);
  await assert.rejects(scalar('SELECT public.delete_platform_user($1)',[owner]),/permission denied/);

  await db.exec('RESET ROLE');
  const newUser = randomUUID();
  await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)',[newUser,'bukkasaivinith2@gmail.com',JSON.stringify({first_name:'New',last_name:'Account'})]);
  assert.equal(await scalar('SELECT first_name FROM public.profiles WHERE id=$1',[newUser]),'New');
  assert.equal(Number(await scalar('SELECT count(*) FROM public.platform_administrators WHERE user_id=$1',[newUser])),0);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session})]);
  await db.exec('SET ROLE authenticated');
 });
 await t.test('a new IPO and its demat applications save atomically without posting cash', async () => {
  const companyDraft = { name: 'New IPO with two applications', classification: 'Mainboard', issue_price: 33.33, lot_size: 3, minimum_lots: 1 };
  const existingDemat = (await db.query("SELECT id FROM public.ipo_applicant_accounts WHERE nickname='Personal'")).rows[0].id;
  const defaults = { date: '2026-01-16', funding_method: 'direct', account_id: bank };
  const applicationDraft = { ...defaults, applicant_account_id: existingDemat, amount: '299.97' };
  const newHolder = { ...defaults, holder_name: 'New holder', designation: 'friend', nickname: 'Other demat', amount: '99.99' };
  const insert = (drafts, key = randomUUID()) => scalar('SELECT public.ipo_create_with_applications($1,$2,$3)', [
   key, JSON.stringify(companyDraft), JSON.stringify(drafts),
  ]);
  const originalBalance = await ledger(bank);
  await assert.rejects(insert([applicationDraft, { ...newHolder, amount: '100' }]), /must match whole lots/);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_companies WHERE name=$1', [companyDraft.name])), 0);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.ipo_applicants WHERE name='New holder'")), 0);

  const key = randomUUID();
  const saved = await insert([applicationDraft, newHolder], key);
  assert.deepEqual(await insert([applicationDraft, newHolder], key), saved);
  await assert.rejects(insert([applicationDraft], key), /different details/);
  const applications = (await db.query(
   'SELECT lots, amount FROM public.ipo_applications WHERE company_id=$1 ORDER BY lots', [saved.id],
  )).rows;
  assert.deepEqual(applications.map(record => [record.lots, Number(record.amount)]), [[1, 99.99], [3, 299.97]]);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.ipo_applicants WHERE name='New holder'")), 1);
  assert.equal(await ledger(bank), originalBalance);
 });
 await t.test('retiring IPO blocks its app commands and preserves the existing ledger', async () => {
  const bankBalance = await ledger(bank);
  const transactionCount = await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]);
  const applicationCount = await scalar('SELECT count(*) FROM public.ipo_applications');
  await db.exec('RESET ROLE');
  const migration = await readFile(new URL(disableIpoMigration, directory), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Safe to run again if deployment is retried.
  await db.exec('SET ROLE authenticated');

  await assert.rejects(scalar('SELECT public.ipo_dashboard()'), /permission denied/);
  await assert.rejects(command('company', { name: 'Disabled' }), /permission denied/);
  await assert.rejects(scalar("SELECT public.ipo_create_with_applications($1, '{}', '[]')", [randomUUID()]), /permission denied/);
  assert.equal(await scalar('SELECT count(*) FROM public.ipo_applications'), applicationCount);
  assert.equal(await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]), transactionCount);
  assert.equal(await ledger(bank), bankBalance);
  const legacy = await scalar('SELECT public.ipo_finance_links($1)', [owner]);
  assert.ok(legacy.accounts.some((account) => account.custody));
  assert.ok(legacy.investments.some((link) => link.id === investment));
 });
 await t.test('the new portfolio saves whole lots and scheduled listings without reopening legacy commands', async () => {
  const bankBalance = await ledger(bank);
  const transactionCount = await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]);
  await db.exec('RESET ROLE');
  const migration = await readFile(new URL(portfolioMigration, directory), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('SET ROLE authenticated');

  const draft = {
   company_name: 'New portfolio IPO', classification: 'SME', application_date: '2026-01-20', listing_date: '2099-01-23',
   issue_price: '33.33', lot_size: '3', amount: '299.97', account_id: bank,
   demat_id: '', holder_name: 'Portfolio test holder', designation: 'friend',
  };
  const save = (input, key = randomUUID()) =>
   scalar('SELECT public.save_ipo_portfolio_application($1, $2)', [key, JSON.stringify(input)]);

  await assert.rejects(save({ ...draft, amount: '300.00' }), /whole number of lots/);
  await assert.rejects(save({ ...draft, listing_date: '2026-01-19' }), /on or after the application date/);
  await assert.rejects(save({ ...draft, account_id: randomUUID() }), /active bank or cash account/);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_companies WHERE name=$1', [draft.company_name])), 0);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_applicants WHERE name=$1', [draft.holder_name])), 0);

  const key = randomUUID();
  const id = await save(draft, key);
  assert.equal(await save(draft, key), id);
  await assert.rejects(save({ ...draft, amount: '99.99' }, key), /already used for different details/);
  const data = await scalar('SELECT public.get_ipo_portfolio()');
  const application = data.applications.find((entry) => entry.id === id);
  assert.deepEqual({
   company: application.company, date: application.application_date, listing: application.listing_date,
   holder: application.holder, amount: Number(application.amount), lotSize: application.lot_size, lots: application.lots,
  }, {
   company: draft.company_name, date: draft.application_date, listing: draft.listing_date,
   holder: draft.holder_name, amount: 299.97, lotSize: 3, lots: 3,
  });
  const demat = data.demat_accounts.find((entry) => entry.holder === draft.holder_name);
  assert.ok(demat);
  const second = await save({ ...draft, amount: '99.99', demat_id: demat.id, holder_name: '' });
  assert.equal((await row('ipo_applications', second)).company_id, application.company_id);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_companies WHERE name=$1', [draft.company_name])), 1);
  assert.equal(await ledger(bank), bankBalance);
  assert.equal(await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]), transactionCount);
  await assert.rejects(command('company', { name: 'Legacy still disabled' }), /permission denied/);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  await assert.rejects(scalar('SELECT public.get_ipo_portfolio()'), /session|workspace owner/i);
  await assert.rejects(save(draft), /session|workspace owner/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('demat accounts feed whole-lot allocations and their removal preserves past applications', async () => {
  const bankBalance = await ledger(bank);
  const transactionCount = await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]);
  await db.exec('RESET ROLE');
  const migration = await readFile(new URL(dematLotsMigration, directory), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('SET ROLE authenticated');

  const add = (holder, nickname, designation = 'friend') => scalar('SELECT public.save_ipo_demat_account($1,$2,$3)', [holder, nickname, designation]);
  const remove = (id) => scalar('SELECT public.archive_ipo_demat_account($1)', [id]);
  const first = await add('First holder', '', 'self');
  assert.equal(await add('first holder', 'Demat', 'self'), first);
  const second = await add('Second holder', 'Broker');
  const alternate = await add('Second holder', 'Other broker');
  assert.notEqual(alternate, second);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.ipo_applicants WHERE name='Second holder'")), 1);

  const draft = {
   company_name: 'Split lot IPO', classification: 'Mainboard', application_date: '2026-01-21',
   listing_date: '2099-01-24', issue_price: '272.00', lot_size: '55', account_id: bank,
  };
  const allocations = [{ demat_id: first, lots: 2 }, { demat_id: second, lots: 1 }];
  const save = (input, total, key = randomUUID()) =>
   scalar('SELECT public.save_ipo_portfolio_applications($1,$2,$3,$4)', [key, JSON.stringify(draft), JSON.stringify(input), total]);
  await assert.rejects(save(allocations, 4), /must add up/);
  await assert.rejects(save([{ demat_id: first, lots: 2 }, { demat_id: first, lots: 1 }], 3), /only once/);
  await assert.rejects(save([{ demat_id: first, lots: 2 }, { demat_id: randomUUID(), lots: 1 }], 3), /active demat account/);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_companies WHERE name=$1', [draft.company_name])), 0);

  const key = randomUUID();
  const ids = await save(allocations, 3, key);
  assert.deepEqual(await save(allocations, 3, key), ids);
  await assert.rejects(save([{ demat_id: first, lots: 2 }, { demat_id: alternate, lots: 1 }], 3, key), /already used for different details/);
  const applications = await Promise.all(ids.map((id) => row('ipo_applications', id)));
  assert.deepEqual(applications.map((application) => [application.applicant_account_id, application.lots, Number(application.amount)]),
   [[first, 2, 29920], [second, 1, 14960]]);
  assert.equal(applications[0].company_id, applications[1].company_id);

  await remove(second);
  await remove(second);
  const data = await scalar('SELECT public.get_ipo_portfolio()');
  assert.ok(data.demat_accounts.some((account) => account.id === first));
  assert.ok(data.demat_accounts.some((account) => account.id === alternate));
  assert.ok(!data.demat_accounts.some((account) => account.id === second));
  assert.equal(data.applications.find((application) => application.id === ids[1]).holder, 'Second holder');
  await assert.rejects(save(allocations, 3), /active demat account/);
  assert.deepEqual(await save(allocations, 3, key), ids);
  assert.equal(await ledger(bank), bankBalance);
  assert.equal(await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]), transactionCount);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  await assert.rejects(add('Wrong owner', ''), /session|workspace owner/i);
  await assert.rejects(remove(first), /session|workspace owner/i);
  await assert.rejects(save(allocations, 3), /session|workspace owner/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('broker apps distinguish demat accounts and edits preserve existing applications', async () => {
  const beforeBalance = await ledger(bank);
  const before = await scalar('SELECT public.get_ipo_portfolio()');
  const target = before.demat_accounts.find((account) => account.holder === 'First holder');
  const sibling = await scalar('SELECT public.save_ipo_demat_account($1,$2,$3)', [target.holder, 'Backup', 'self']);
  const original = await row('ipo_applicant_accounts', target.id);
  const previousApplication = before.applications.find((entry) => entry.company === 'Split lot IPO' && entry.holder === target.holder);

  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(editDematMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const edit = (id, holder, nickname, designation, broker = '') =>
   scalar('SELECT public.update_ipo_demat_account($1,$2,$3,$4,$5)', [id, holder, nickname, designation, broker]);
  const addWithBroker = (holder, nickname, designation, broker) =>
   scalar('SELECT public.save_ipo_demat_account($1,$2,$3,$4)', [holder, nickname, designation, broker]);
  await assert.rejects(edit(target.id, 'Updated holder', 'backup', 'friend'), /already has a demat account/);
  assert.equal((await row('ipo_applicants', original.applicant_id)).name, target.holder);
  await assert.rejects(edit(target.id, 'Second holder', 'Updated broker', 'friend'), /already uses that name/);
  await assert.rejects(edit(randomUUID(), 'Other holder', '', 'friend'), /account unavailable/);

  const kite = await addWithBroker('Broker test holder', '', 'friend', 'Kite');
  const groww = await addWithBroker('Broker test holder', '', 'friend', 'Groww');
  assert.notEqual(kite, groww);
  assert.equal(await addWithBroker('Broker test holder', '', 'friend', 'kite'), kite);
  await assert.rejects(edit(groww, 'Broker test holder', '', 'friend', 'Kite'), /already has a demat account/);

  await edit(target.id, 'Updated holder', 'Primary demat', 'friend', 'Upstox');
  const data = await scalar('SELECT public.get_ipo_portfolio()');
  assert.deepEqual(data.demat_accounts.find((account) => account.id === target.id), {
   id: target.id, holder: 'Updated holder', demat: 'Primary demat', designation: 'friend', broker: 'Upstox',
  });
  assert.equal(data.demat_accounts.find((account) => account.id === sibling).holder, 'Updated holder');
  assert.equal(data.demat_accounts.find((account) => account.id === kite).broker, 'Kite');
  assert.equal(data.demat_accounts.find((account) => account.id === groww).broker, 'Groww');
  const updated = data.applications.find((entry) => entry.id === previousApplication.id);
  assert.equal(updated.demat, 'Primary demat');
  assert.equal(updated.broker, 'Upstox');
  assert.equal(updated.demat_account_id, target.id);
  assert.equal(updated.amount, previousApplication.amount);
  assert.equal((await row('ipo_applications', updated.id)).applicant_account_id, target.id);
  assert.equal(await ledger(bank), beforeBalance);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  await assert.rejects(edit(target.id, 'Wrong owner', '', 'friend'), /session|workspace owner/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('application corrections and removals preserve other applications and the ledger', async () => {
  const bankBalance = await ledger(bank);
  const count = await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]);
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(manageApplicationsMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const data = await scalar('SELECT public.get_ipo_portfolio()');
  const target = data.applications.find((entry) => entry.company === 'Split lot IPO' && entry.holder === 'Updated holder');
  const sibling = data.applications.find((entry) => entry.company_id === target.company_id && entry.id !== target.id);
  const linked = data.applications.find((entry) => entry.can_change === false);
  assert.ok(target.can_change);
  assert.equal(target.funding_account_id, bank);
  assert.ok(linked);
  const draft = {
   company_name: 'Corrected listing', classification: 'Mainboard', application_date: '2026-01-21',
   listing_date: '2099-01-25', issue_price: '272.00', lot_size: '55', lots: 3,
   demat_id: target.demat_account_id, account_id: bank,
  };
  const edit = (id, input, key = randomUUID()) => scalar('SELECT public.update_ipo_portfolio_application($1,$2,$3)', [id, key, JSON.stringify(input)]);
  const remove = (id) => scalar('SELECT public.archive_ipo_portfolio_application($1)', [id]);
  await assert.rejects(edit(linked.id, draft), /linked activity/);
  await assert.rejects(remove(linked.id), /linked activity/);
  await assert.rejects(edit(target.id, { ...draft, lots: 1.5 }), /valid issue price, shares per lot and number of lots/);
  await assert.rejects(edit(target.id, { ...draft, listing_date: '2025-12-31' }), /listing date/);

  const key = randomUUID();
  await edit(target.id, draft, key);
  await edit(target.id, draft, key);
  await assert.rejects(edit(target.id, { ...draft, lots: 2 }, key), /already used for different details/);
  const edited = await scalar('SELECT public.get_ipo_portfolio()');
  const updated = edited.applications.find((entry) => entry.id === target.id);
  const siblingAfter = edited.applications.find((entry) => entry.id === sibling.id);
  assert.equal(updated.company, draft.company_name);
  assert.equal(updated.listing_date, draft.listing_date);
  assert.equal(updated.lots, 3);
  assert.equal(Number(updated.amount), 44880);
  assert.equal(siblingAfter.company, draft.company_name);
  assert.equal(siblingAfter.lots, sibling.lots);
  assert.equal(siblingAfter.amount, sibling.amount);
  assert.equal((await row('ipo_applicant_accounts', sibling.demat_account_id)).archived, true);
  await edit(sibling.id, { ...draft, demat_id: sibling.demat_account_id, lots: 2 });
  const archivedAccountApplication = await row('ipo_applications', sibling.id);
  assert.equal(archivedAccountApplication.applicant_account_id, sibling.demat_account_id);
  assert.equal(Number(archivedAccountApplication.amount), 29920);

  await remove(target.id);
  await remove(target.id);
  const remaining = await scalar('SELECT public.get_ipo_portfolio()');
  assert.ok(!remaining.applications.some((entry) => entry.id === target.id));
  assert.ok(remaining.applications.some((entry) => entry.id === sibling.id));
  assert.equal((await row('ipo_applications', target.id)).lots, 3);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.ipo_events WHERE application_id=$1 AND command='delete_application'", [target.id])), 1);
  await assert.rejects(edit(target.id, draft), /was deleted/);
  assert.equal(await ledger(bank), bankBalance);
  assert.equal(await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]), count);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  await assert.rejects(edit(sibling.id, draft), /session|workspace owner/i);
  await assert.rejects(remove(sibling.id), /session|workspace owner/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('allotment dates persist across demat accounts and can be updated or cleared', async () => {
  const bankBalance = await ledger(bank);
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(allotmentDateMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const load = () => scalar('SELECT public.get_ipo_portfolio()');
  const portfolio = await load();
  assert.equal(portfolio.allotment_date_supported, true);
  assert.equal(portfolio.applications.find((entry) => entry.company === 'Corrected listing').allotment_date, null);
  const [first, second] = portfolio.demat_accounts;
  const allocations = [{ demat_id: first.id, lots: 1 }, { demat_id: second.id, lots: 1 }];
  const base = {
   company_name: 'Dated allotment IPO', classification: 'Mainboard', application_date: '2026-01-23',
   listing_date: '2099-02-01', issue_price: '100', lot_size: '10', account_id: bank,
  };
  const draft = { ...base, allotment_date: '2099-01-26' };
  const save = (input, key = randomUUID()) => scalar('SELECT public.save_ipo_portfolio_applications($1,$2,$3,$4)',
   [key, JSON.stringify(input), JSON.stringify(allocations), 2]);
  const key = randomUUID();
  await assert.rejects(save({ ...draft, allotment_date: '2026-01-22' }), /allotment date must/);
  await assert.rejects(save({ ...draft, allotment_date: '2099-02-02' }), /allotment date must/);
  const ids = await save(draft, key);
  assert.deepEqual(await save(draft, key), ids);
  await assert.rejects(save({ ...draft, allotment_date: '2099-01-27' }, key), /already used for different details/);
  await assert.rejects(save({ ...draft, allotment_date: '2099-01-27' }), /different allotment date/);
  const readDates = async () => (await load()).applications.filter((entry) => ids.includes(entry.id)).map((entry) => entry.allotment_date);
  assert.deepEqual(await readDates(), ['2099-01-26', '2099-01-26']);

  const edit = (input, requestId = randomUUID()) => scalar('SELECT public.update_ipo_portfolio_application($1,$2,$3)',
   [ids[0], requestId, JSON.stringify({ ...input, ...allocations[0] })]);
  await assert.rejects(edit({ ...draft, listing_date: '2099-01-25' }), /allotment date must/);
  await edit(base);
  assert.deepEqual(await readDates(), ['2099-01-26', '2099-01-26']);
  const editKey = randomUUID();
  await edit({ ...draft, allotment_date: '2099-01-29' }, editKey);
  await edit({ ...draft, allotment_date: '2099-01-29' }, editKey);
  assert.deepEqual(await readDates(), ['2099-01-29', '2099-01-29']);
  await edit({ ...draft, allotment_date: '' });
  assert.deepEqual(await readDates(), [null, null]);
  assert.equal(await ledger(bank), bankBalance);
 });
 await t.test('savings edits and deletions persist independently of the transaction ledger', async () => {
  const count = await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]);
  const bankBalance = await ledger(bank);
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(savingsMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const add = (amount, location, name) => scalar(
   "INSERT INTO public.savings_entries (name, amount, saved_on, storage_type) VALUES ($1,$2,'2026-01-10',$3) RETURNING id",
   [name, amount, location]);
  const balances = async () => (await db.query('SELECT storage_type, balance FROM public.get_savings_balances() ORDER BY storage_type'))
   .rows.map((entry) => [entry.storage_type, Number(entry.balance)]);
  const bankSaving = await add('1200.50', 'bank', 'Emergency fund');
  const cashSaving = await add(400, 'cash', 'Backup cash');
  await assert.rejects(add('NaN', 'other', 'Invalid amount'), /check constraint/);
  await assert.rejects(add(15, 'unsupported', 'Invalid location'), /check constraint/);
  assert.deepEqual(await balances(), [['bank', 1200.50], ['cash', 400]]);

  await db.query("UPDATE public.savings_entries SET amount=1300, storage_type='other' WHERE id=$1 RETURNING id", [bankSaving]);
  await db.query('DELETE FROM public.savings_entries WHERE id=$1 RETURNING id', [cashSaving]);
  assert.deepEqual(await balances(), [['other', 1300]]);
  assert.equal((await row('savings_entries', bankSaving)).name, 'Emergency fund');
  assert.equal(await ledger(bank), bankBalance);
  assert.equal(await scalar('SELECT count(*) FROM public.get_workspace_transactions($1)', [owner]), count);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  assert.deepEqual(await balances(), []);
  assert.equal((await db.query('DELETE FROM public.savings_entries WHERE id=$1 RETURNING id', [bankSaving])).rows.length, 0);
  await assert.rejects(add(20, 'cash', 'Blocked session'), /row-level security/);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
  assert.deepEqual(await balances(), [['other', 1300]]);
 });
 await t.test('manual IPO results persist and booked sales remain the source for linked applications', async () => {
  const bankBalance = await ledger(bank);
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(ipoResultsMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const load = () => scalar('SELECT public.get_ipo_portfolio()');
  const portfolio = await load();
  const manual = portfolio.applications.filter((entry) => entry.company === 'Dated allotment IPO');
  const booked = portfolio.applications.find((entry) => entry.id === application);
  assert.equal(manual.length, 2);
  assert.equal(manual[0].realized_profit_loss, null);
  assert.equal(Number(booked.realized_profit_loss), -420);
  assert.equal(Number(booked.invested_amount), 6010);

  const save = (id, result, invested = null) => scalar('SELECT public.set_ipo_application_result($1,$2,$3)', [id, result, invested]);
  await assert.rejects(save(booked.id, 1), /linked activity/);
  await assert.rejects(save(manual[0].id, 123.456), /two decimal places/);
  await assert.rejects(save(manual[0].id, 250.75, -75), /positive invested amount/);
  await save(manual[0].id, 250.75, 1000);
  await save(manual[0].id, 250.75, 1000);
  await save(manual[1].id, -100.5);
  const results = async () => (await load()).applications.filter((entry) => manual.some((item) => item.id === entry.id))
   .map((entry) => entry.realized_profit_loss);
  assert.deepEqual(await results(), [250.75, -100.5]);
  assert.equal((await load()).applications.find((entry) => entry.id === manual[0].id).invested_amount, 1000);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.ipo_events WHERE application_id=$1 AND command='record_result'", [manual[0].id])), 1);

  await save(manual[0].id, 0);
  await save(manual[1].id, null);
  assert.deepEqual(await results(), [0, null]);
  await scalar('SELECT public.archive_ipo_portfolio_application($1)', [manual[0].id]);
  assert.deepEqual(await results(), [null]);
  await assert.rejects(save(manual[0].id, 20), /linked activity/);
  assert.equal(await ledger(bank), bankBalance);
 });
 await t.test('savings account movements update balances and preserve history when a custom location is removed', async () => {
  const bankBalance = await ledger(bank);
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(savingsHistoryMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const accountsSql = 'SELECT id, balance FROM public.savings_accounts ORDER BY last_activity_at DESC, id DESC';
  const accounts = async () => (await db.query(accountsSql)).rows.map((account) => [account.id, Number(account.balance)]);
  const existing = await accounts();
  assert.equal(existing.length, 1);
  const [savingsId, originalBalance] = existing[0];
  assert.equal(originalBalance, 1300);
  const cash = await scalar("INSERT INTO public.savings_entries(name, amount, saved_on, storage_type) VALUES ('Separate cash',200,'2026-01-11','cash') RETURNING id");
  assert.deepEqual(await accounts(), [[cash, 200], [savingsId, 1300]]);

  const location = await scalar("INSERT INTO public.savings_locations(name) VALUES ('Locker') RETURNING id");
  await assert.rejects(db.query("INSERT INTO public.savings_locations(name) VALUES (' locker ')"), /duplicate key/);
  await db.query('UPDATE public.savings_entries SET location_id=$1 WHERE id=$2', [location, savingsId]);
  await db.query("UPDATE public.savings_locations SET name='Home locker' WHERE id=$1", [location]);
  assert.equal(await scalar('SELECT name FROM public.savings_locations WHERE id=$1', [location]), 'Home locker');

  const move = (kind, amount, key = randomUUID()) =>
   scalar("SELECT public.record_savings_movement($1,$2,$3,$4,'test movement')", [savingsId, key, kind, amount]);
  const request = randomUUID();
  assert.equal((await move('withdrawal', 900, request)).account.balance, 400);
  assert.equal((await move('withdrawal', 900, request)).account.balance, 400);
  await assert.rejects(move('withdrawal', 850, request), /already used/);
  const deposit = await move('deposit', 200);
  assert.equal(deposit.account.balance, 600);
  assert.deepEqual(await accounts(), [[savingsId, 600], [cash, 200]]);
  await assert.rejects(move('withdrawal', 601), /exceeds the available/);
  const attempts = await Promise.allSettled([move('withdrawal', 375), move('withdrawal', 375)]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.deepEqual(await accounts(), [[savingsId, 225], [cash, 200]]);
  await assert.rejects(db.query('UPDATE public.savings_entries SET amount=800 WHERE id=$1', [savingsId]), /past savings balance negative/);
  assert.equal(Number(await scalar("SELECT balance FROM public.get_savings_balances() WHERE storage_type='other'")), 225);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.savings_movements WHERE savings_entry_id=$1', [savingsId])), 3);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.savings_movements WHERE savings_entry_id=$1', [cash])), 0);

  await db.query('DELETE FROM public.savings_locations WHERE id=$1', [location]);
  assert.equal(await scalar('SELECT location_id FROM public.savings_accounts WHERE id=$1', [savingsId]), null);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.savings_movements')), 3);
  assert.equal(await ledger(bank), bankBalance);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  assert.deepEqual(await accounts(), []);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.savings_movements')), 0);
  await assert.rejects(move('deposit', 25), /Sign in again/);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('IPO present value persists independently of invested capital and realised results', async () => {
  const bankBalance = await ledger(bank);
  const load = () => scalar('SELECT public.get_ipo_portfolio()');
  const target = (await load()).applications.find((entry) => entry.company === 'Dated allotment IPO');
  await scalar('SELECT public.set_ipo_application_result($1,$2,$3)', [target.id, 150, 1000]);
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(ipoPresentValueMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const save = (result, value) => scalar('SELECT public.save_ipo_portfolio_result($1,$2,$3)', [target.id, result, value]);
  const read = async () => (await load()).applications.find((entry) => entry.id === target.id);
  assert.equal((await read()).present_total_value, null);
  await assert.rejects(save(150, -1), /present total value/);
  await assert.rejects(save(150, 123.456), /two decimal places/);
  await save(150, 1250.75);
  await save(150, 1250.75);
  const updated = await read();
  assert.equal(updated.invested_amount, 1000);
  assert.equal(updated.realized_profit_loss, 150);
  assert.equal(updated.present_total_value, 1250.75);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.ipo_events WHERE application_id=$1 AND payload ? 'present_total_value'", [target.id])), 1);
  await save(150, 0);
  assert.equal((await read()).present_total_value, 0);
  await save(150, null);
  assert.equal((await read()).present_total_value, null);
  assert.equal((await read()).invested_amount, 1000);
  assert.equal(await ledger(bank), bankBalance);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  await assert.rejects(save(150, 200), /session|workspace owner/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('not allotted is persisted and uses the application lot price without posting money', async () => {
  const bankBalance = await ledger(bank);
  const load = () => scalar('SELECT public.get_ipo_portfolio()');
  const target = (await load()).applications.find((entry) => entry.company === 'Dated allotment IPO');
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(ipoNotAllottedMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const save = (profitLoss, presentValue, notAllotted) => scalar('SELECT public.save_ipo_portfolio_result($1,$2,$3,$4)', [target.id, profitLoss, presentValue, notAllotted]);
  const read = async () => (await load()).applications.find((entry) => entry.id === target.id);
  assert.equal((await read()).not_allotted, false);
  assert.equal((await read()).realized_profit_loss, 150);
  await assert.rejects(save(150, null, true), /cannot have a profit/);
  await assert.rejects(save(null, 1250, true), /cannot have a profit/);

  assert.deepEqual(await save(null, null, true), { not_allotted: true, realized_profit_loss: null, present_total_value: null, invested_amount: null });
  await save(null, null, true);
  const stored = await read();
  assert.equal(stored.not_allotted, true);
  assert.equal(stored.realized_profit_loss, null);
  assert.equal(stored.invested_amount, null);
  assert.equal(stored.present_total_value, null);
  assert.equal(stored.issue_price * stored.lot_size, target.issue_price * target.lot_size);
  assert.equal(stored.amount, target.amount);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.ipo_events WHERE application_id=$1 AND payload->>'not_allotted' = 'true'", [target.id])), 1);

  await save(0, 1250, false);
  assert.equal((await read()).not_allotted, false);
  assert.equal((await read()).realized_profit_loss, 0);
  assert.equal((await read()).present_total_value, 1250);
  assert.equal((await read()).invested_amount, target.invested_amount);
  await save(null, null, true);
  await scalar('SELECT public.save_ipo_portfolio_result($1,$2,$3)', [target.id, null, null]);
  assert.equal((await read()).not_allotted, false);
  await save(null, null, true);
  await scalar('SELECT public.set_ipo_application_result($1,$2,$3)', [target.id, 42, 1000]);
  assert.equal((await read()).not_allotted, false);
  assert.equal((await read()).realized_profit_loss, 42);
  assert.equal(await ledger(bank), bankBalance);

  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  await assert.rejects(save(null, null, true), /session|workspace owner/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('scoped finance reads require the owner session and page without dropping records', async () => {
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(financeReadsMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const list = async (requestedOwner, cursor = null, limit = 1000, scheduledOnly = false, transactionId = null) =>
    (await db.query('SELECT * FROM public.get_finance_transaction_page($1,$2,$3,$4,$5)', [requestedOwner, cursor, limit, scheduledOnly, transactionId])).rows;
  const usage = () => scalar('SELECT public.get_finance_transaction_usage($1)', [owner]);
  const full = await list(owner);
  assert.ok(full.length > 1);
  assert.deepEqual(full.map((entry) => entry.id),
    (await db.query('SELECT id FROM public.transactions WHERE user_id = $1 ORDER BY id', [owner])).rows.map((entry) => entry.id));
  const first = await list(owner, null, 1);
  assert.deepEqual(first, full.slice(0, 1));
  assert.deepEqual(await list(owner, first[0].id), full.slice(1));
  assert.deepEqual(await list(owner, null, 1000, true), full.filter((entry) => entry.transaction_source === 'scheduled'));
  assert.deepEqual(await list(owner, null, 1000, false, first[0].id), first);
  const counts = (key) => full.reduce((map, entry) => {
    if (entry[key]) map[entry[key]] = (map[entry[key]] ?? 0) + 1;
    return map;
  }, {});
  assert.deepEqual(await usage(), { types: counts('transaction_type_id'), categories: counts('category_id') });
  await assert.rejects(list(other), /workspace is unavailable/i);
  await assert.rejects(db.query('SELECT public.list_platform_users()'), /permission denied/i);

  await db.exec('RESET ROLE; SET ROLE anon;');
  await assert.rejects(list(owner), /permission denied/i);
  await assert.rejects(db.query('SELECT id FROM public.transactions'), /permission denied/i);
  await db.exec('RESET ROLE; SET ROLE authenticated;');
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  await assert.rejects(list(owner), /session|owner/i);
  await assert.rejects(usage(), /session|owner/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: randomUUID() })]);
  await assert.rejects(list(owner), /session/i);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
 });
 await t.test('savings account emojis persist through edits and movements with owner-only access', async () => {
  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(savingsEmojiMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');

  const existing = (await db.query("SELECT emoji, balance FROM public.savings_accounts WHERE name='Emergency fund'")).rows[0];
  assert.equal(existing.emoji, null);
  assert.equal(Number(existing.balance), 225);
  const id = await scalar(
   "INSERT INTO public.savings_entries(name, amount, saved_on, storage_type, emoji) VALUES ('Holiday', 100, '2026-01-11', 'cash', $1) RETURNING id",
   ['✈️']);
  const read = () => scalar('SELECT emoji FROM public.savings_accounts WHERE id=$1', [id]);
  assert.equal(await read(), '✈️');

  const editedEmoji = '👨‍👩‍👧‍👦';
  await db.query('UPDATE public.savings_entries SET emoji=$1 WHERE id=$2', [editedEmoji, id]);
  assert.equal(await read(), editedEmoji);
  const movement = await scalar("SELECT public.record_savings_movement($1,$2,'deposit',20,'')", [id, randomUUID()]);
  assert.equal(movement.account.emoji, editedEmoji);
  assert.equal(movement.account.balance, 120);

  await assert.rejects(db.query('UPDATE public.savings_entries SET emoji=$1 WHERE id=$2', ['💰'.repeat(17), id]), /check constraint/);
  assert.equal(await read(), editedEmoji);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: other, session_id: session })]);
  assert.equal((await db.query('SELECT emoji FROM public.savings_accounts WHERE id=$1', [id])).rows.length, 0);
  assert.equal((await db.query('UPDATE public.savings_entries SET emoji=NULL WHERE id=$1 RETURNING id', [id])).rows.length, 0);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session })]);
  assert.equal(await read(), editedEmoji);
  await db.query('UPDATE public.savings_entries SET emoji=NULL WHERE id=$1', [id]);
  assert.equal(await read(), null);
 });
 await t.test('fixed finance types preserve category links, ledger history, and scheduled entries', async () => {
  const legacy = await scalar("INSERT INTO public.transaction_types(user_id,name,kind) VALUES(auth.uid(),'Legacy grocery purchase','expense') RETURNING id");
  const category = await scalar("INSERT INTO public.categories(user_id,name) VALUES(auth.uid(),'Legacy grocery category') RETURNING id");
  await db.query('INSERT INTO public.category_transaction_types(user_id,category_id,transaction_type_id) VALUES(auth.uid(),$1,$2)', [category, legacy]);
  const insertExpense = (typeId, categoryId) => scalar(
    "INSERT INTO public.transactions(user_id,name,transaction_type_id,category_id,amount,transaction_date,account_id) VALUES(auth.uid(),'Groceries',$1,$2,25,CURRENT_DATE,$3) RETURNING id",
    [typeId, categoryId, bank]);
  const oldEntry = await insertExpense(legacy, category);
  const recurring = await scalar("INSERT INTO public.recurring_entries(user_id,name,transaction_type_id,category_id,amount,account_id,frequency,next_date,end_date) VALUES(auth.uid(),'Weekly groceries',$1,$2,25,$3,'weekly',CURRENT_DATE,CURRENT_DATE) RETURNING id",
    [legacy, category, bank]);

  await db.exec('RESET ROLE');
  await db.exec(await readFile(new URL(standardTypesMigration, directory), 'utf8'));
  await db.exec('SET ROLE authenticated');
  await db.exec('SELECT public.open_finance_workspace(); SELECT public.open_finance_workspace()');
  const kinds = new Map((await db.query('SELECT kind,id FROM public.transaction_types WHERE is_standard')).rows.map(({ kind, id }) => [kind, id]));
  assert.deepEqual([...kinds.keys()].sort(), ['expense', 'income', 'transfer']);
  await assert.rejects(db.query("INSERT INTO public.transaction_types(user_id,name,kind) VALUES(auth.uid(),'Custom type','expense')"), /permission denied/);
  assert.equal((await row('transactions', oldEntry)).transaction_type_id, legacy);
  assert.equal((await row('transactions', oldEntry)).transaction_type_name, 'Legacy grocery purchase');
  assert.equal((await row('transactions', await insertExpense(kinds.get('expense'), category))).transaction_kind, 'expense');
  const createCategory = (name, ids) => scalar('SELECT public.create_finance_category($1,NULL,NULL,$2::uuid[])', [name, ids]);
  await assert.rejects(createCategory('Rejected category', [legacy]), /Choose Income/);
  assert.equal(Number(await scalar("SELECT count(*) FROM public.categories WHERE name='Rejected category'")), 0);
  const newCategory = await createCategory('Standard category', [kinds.get('income'), kinds.get('expense')]);
  const income = await scalar("INSERT INTO public.transactions(user_id,name,transaction_type_id,category_id,amount,transaction_date,account_id) VALUES(auth.uid(),'Income',$1,$2,25,CURRENT_DATE,$3) RETURNING transaction_kind",
    [kinds.get('income'), newCategory, bank]);
  assert.equal(income, 'income');
  const destination = await scalar("INSERT INTO public.accounts(user_id,name,opening_balance,opening_balance_date,is_liability) VALUES(auth.uid(),'Destination account',0,CURRENT_DATE,false) RETURNING id");
  const transfer = await scalar("INSERT INTO public.transactions(user_id,name,transaction_type_id,amount,transaction_date,account_id,to_account_id) VALUES(auth.uid(),'Transfer',$1,25,CURRENT_DATE,$2,$3) RETURNING transaction_kind",
    [kinds.get('transfer'), bank, destination]);
  assert.equal(transfer, 'transfer');
  await db.query('SELECT public.update_finance_category($1,$2,NULL,NULL,$3::uuid[])', [category, 'Groceries', [kinds.get('income')]]);
  await assert.rejects(insertExpense(kinds.get('expense'), category), /category does not fit/);
  await scalar('SELECT public.process_due_recurring_entries()');
  assert.equal(await scalar('SELECT transaction_kind FROM public.transactions WHERE recurring_entry_id=$1', [recurring]), 'expense');
  assert.equal((await row('transactions', oldEntry)).transaction_type_id, legacy);
  const investmentType = await scalar("SELECT public.create_investment_type('Standard test')");
  const investment = await scalar('SELECT public.record_investment($1,$2,$3,$4,$5,CURRENT_DATE)', ['New investment', investmentType, '', bank, 50]);
  assert.equal(await scalar('SELECT transaction_kind FROM public.transactions WHERE investment_id=$1', [investment]), 'expense');
 });
 await t.test('self-deletion clears private records and a new signup cannot inherit the owner slot',async()=>{
  await db.query('SELECT public.delete_my_finance_account()');
  await db.exec('RESET ROLE');
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_events WHERE user_id=$1',[owner])),0);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.savings_entries WHERE user_id=$1',[owner])),0);
  assert.equal(Number(await scalar('SELECT count(*) FROM public.savings_movements WHERE user_id=$1',[owner])),0);
  assert.equal(Number(await scalar('SELECT count(*) FROM auth.users WHERE id=$1',[owner])),0);
  const replacement = randomUUID();
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[replacement,'bukkasaivinith@gmail.com']);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:replacement})]);
  await db.exec('SET ROLE authenticated');
  assert.equal(await scalar('SELECT public.is_finance_workspace_owner()'),false);
 });
});
