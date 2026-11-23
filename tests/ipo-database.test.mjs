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
 for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
  if ([ownerMigration, disableIpoMigration, portfolioMigration].includes(name)) continue; // Test each upgrade with existing data.
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
 await t.test('self-deletion clears private records and a new signup cannot inherit the owner slot',async()=>{
  await db.query('SELECT public.delete_my_finance_account()');
  await db.exec('RESET ROLE');
  assert.equal(Number(await scalar('SELECT count(*) FROM public.ipo_events WHERE user_id=$1',[owner])),0);
  assert.equal(Number(await scalar('SELECT count(*) FROM auth.users WHERE id=$1',[owner])),0);
  const replacement = randomUUID();
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[replacement,'bukkasaivinith@gmail.com']);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:replacement})]);
  await db.exec('SET ROLE authenticated');
  assert.equal(await scalar('SELECT public.is_finance_workspace_owner()'),false);
 });
});
