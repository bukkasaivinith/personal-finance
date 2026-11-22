BEGIN;

CREATE TABLE public.ipo_applicants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80), designation text NOT NULL CHECK(designation IN ('self','friend')),
 relationship text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE public.ipo_applicant_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), applicant_id uuid NOT NULL,
 nickname text NOT NULL CHECK(length(btrim(nickname)) BETWEEN 1 AND 80), broker text NOT NULL DEFAULT '', demat_label text NOT NULL DEFAULT '', bank_nickname text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false, UNIQUE(id,user_id),
 FOREIGN KEY(applicant_id,user_id) REFERENCES public.ipo_applicants(id,user_id)
);
CREATE TABLE public.ipo_companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), symbol text NOT NULL DEFAULT '', classification text NOT NULL CHECK(classification IN ('Mainboard','SME')),
 issue_price numeric(14,2) NOT NULL CHECK(issue_price>0), lot_size integer NOT NULL CHECK(lot_size>0), minimum_lots integer NOT NULL DEFAULT 1 CHECK(minimum_lots>0),
 dates jsonb NOT NULL DEFAULT '{}', notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE public.ipo_cash_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 purpose text NOT NULL CHECK(purpose IN ('friend','escrow','proceeds')), applicant_id uuid,
 account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id),
 FOREIGN KEY(applicant_id,user_id) REFERENCES public.ipo_applicants(id,user_id),
 CHECK((purpose='friend') = (applicant_id IS NOT NULL))
);
CREATE UNIQUE INDEX ipo_cash_purpose ON public.ipo_cash_accounts(user_id,purpose,COALESCE(applicant_id,'00000000-0000-0000-0000-000000000000'));
CREATE TABLE public.ipo_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), company_id uuid NOT NULL, applicant_account_id uuid NOT NULL,
 application_date date NOT NULL, lots integer NOT NULL CHECK(lots>0), lot_size integer NOT NULL CHECK(lot_size>0), issue_price numeric(14,2) NOT NULL CHECK(issue_price>0),
 adjustment numeric(14,2) NOT NULL DEFAULT 0, adjustment_reason text NOT NULL DEFAULT '',
 amount numeric(14,2) GENERATED ALWAYS AS (lots::numeric*lot_size*issue_price+adjustment) STORED CHECK(amount>0),
 funding_method text NOT NULL CHECK(funding_method IN ('direct','friend')), funding_account_id uuid NOT NULL REFERENCES public.accounts(id),
 reference text NOT NULL DEFAULT '', mandate text NOT NULL DEFAULT 'not_requested' CHECK(mandate IN ('not_requested','requested','approved','rejected')),
 status text NOT NULL DEFAULT 'applied', blocked numeric(14,2) NOT NULL DEFAULT 0 CHECK(blocked>=0),
 prepaid numeric(14,2) NOT NULL DEFAULT 0 CHECK(prepaid>=0), refund_due numeric(14,2) NOT NULL DEFAULT 0 CHECK(refund_due>=0),
 notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id),
 FOREIGN KEY(company_id,user_id) REFERENCES public.ipo_companies(id,user_id), FOREIGN KEY(applicant_account_id,user_id) REFERENCES public.ipo_applicant_accounts(id,user_id),
 CHECK(adjustment=0 OR length(btrim(adjustment_reason))>0)
);
CREATE TABLE public.ipo_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), request_id uuid NOT NULL,
 command text NOT NULL, payload jsonb NOT NULL, application_id uuid, company_id uuid, applicant_id uuid,
 event_date date NOT NULL, amount numeric(14,2) NOT NULL DEFAULT 0, expected boolean NOT NULL DEFAULT false,
 memo boolean NOT NULL DEFAULT true, account_id uuid REFERENCES public.accounts(id), details jsonb NOT NULL DEFAULT '{}',
 reversed boolean NOT NULL DEFAULT false, reversal_of uuid UNIQUE REFERENCES public.ipo_events(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(user_id,request_id), UNIQUE(id,user_id),
 FOREIGN KEY(application_id,user_id) REFERENCES public.ipo_applications(id,user_id), FOREIGN KEY(company_id,user_id) REFERENCES public.ipo_companies(id,user_id), FOREIGN KEY(applicant_id,user_id) REFERENCES public.ipo_applicants(id,user_id)
);
CREATE TABLE public.ipo_allotments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), application_id uuid NOT NULL,
 event_id uuid NOT NULL UNIQUE REFERENCES public.ipo_events(id), result text NOT NULL CHECK(result IN ('full','partial','none','rejected','cancelled')),
 shares integer NOT NULL CHECK(shares>=0), purchase_charges numeric(14,2) NOT NULL CHECK(purchase_charges>=0), cost numeric(14,2) NOT NULL CHECK(cost>=0),
 allotted_on date NOT NULL, investment_id uuid UNIQUE REFERENCES public.investments(id), voided boolean NOT NULL DEFAULT false,
 FOREIGN KEY(application_id,user_id) REFERENCES public.ipo_applications(id,user_id)
);
CREATE UNIQUE INDEX ipo_one_live_allotment ON public.ipo_allotments(application_id) WHERE NOT voided;
CREATE TABLE public.ipo_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), application_id uuid NOT NULL,
 event_id uuid NOT NULL UNIQUE REFERENCES public.ipo_events(id), shares integer NOT NULL CHECK(shares>0), price numeric(14,2) NOT NULL CHECK(price>=0), charges numeric(14,2) NOT NULL CHECK(charges>=0),
 gross numeric(14,2) NOT NULL, net numeric(14,2) NOT NULL CHECK(net>=0), cost_basis numeric(14,2) NOT NULL CHECK(cost_basis>=0), profit numeric(14,2) NOT NULL,
 sold_on date NOT NULL, voided boolean NOT NULL DEFAULT false,
 FOREIGN KEY(application_id,user_id) REFERENCES public.ipo_applications(id,user_id)
);
CREATE TABLE public.ipo_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), event_id uuid NOT NULL UNIQUE REFERENCES public.ipo_events(id),
 sale_id uuid REFERENCES public.ipo_sales(id), applicant_id uuid REFERENCES public.ipo_applicants(id),
 amount numeric(14,2) NOT NULL CHECK(amount>0), received_on date NOT NULL, receiving_account_id uuid NOT NULL REFERENCES public.accounts(id),
 kind text NOT NULL CHECK(kind IN ('receipt','repayment','refund','funding')), voided boolean NOT NULL DEFAULT false
);
ALTER TABLE public.transactions ADD COLUMN ipo_event_id uuid REFERENCES public.ipo_events(id);
CREATE INDEX ipo_transactions_event ON public.transactions(ipo_event_id) WHERE ipo_event_id IS NOT NULL;
CREATE INDEX ipo_applications_company ON public.ipo_applications(user_id,company_id,application_date);
CREATE INDEX ipo_events_history ON public.ipo_events(user_id,event_date DESC,created_at DESC);
CREATE INDEX ipo_sales_application ON public.ipo_sales(application_id,sold_on);

-- A caller cannot forge this authorization with a custom PostgreSQL setting.
-- Rows exist only during an atomic IPO command or authorized account deletion.
CREATE TABLE public.ipo_write_context (
 transaction_id bigint PRIMARY KEY, user_id uuid NOT NULL
);
ALTER TABLE public.ipo_write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ipo_write_context FROM PUBLIC,anon,authenticated;

ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_entity_table_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_entity_table_check
 CHECK(entity_table IN ('transaction_types','categories','accounts','transactions','budgets',
 'recurring_entries','authentication','investments','investment_types','workspace','workspace_invitation','ipo_events'));

CREATE FUNCTION public.ipo_require_owner() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=auth.uid();
BEGIN
 PERFORM public.require_current_single_device_session();
 IF u IS NULL OR NOT public.is_finance_user_active(u) OR public.is_platform_admin() THEN RAISE EXCEPTION 'IPO records are available only in your private owner workspace.'; END IF;
 RETURN u;
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ipo_applicants','ipo_applicant_accounts','ipo_companies','ipo_cash_accounts','ipo_applications','ipo_events','ipo_allotments','ipo_sales','ipo_settlements'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY ipo_owner_read ON public.%I FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.is_current_single_device_session() AND public.is_finance_user_active(auth.uid()) AND NOT public.is_platform_admin())',t);
 END LOOP;
END $$;

-- Internal helpers are never callable by browser roles.
CREATE FUNCTION public.ipo_cash_account(p_purpose text,p_applicant uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=public.ipo_require_owner(); a uuid; label text;
BEGIN
 SELECT account_id INTO a FROM public.ipo_cash_accounts WHERE user_id=u AND purpose=p_purpose AND applicant_id IS NOT DISTINCT FROM p_applicant;
 IF a IS NOT NULL THEN RETURN a; END IF;
 IF p_purpose='friend' THEN SELECT name INTO label FROM public.ipo_applicants WHERE id=p_applicant AND user_id=u; IF NOT FOUND THEN RAISE EXCEPTION 'Applicant unavailable.'; END IF; END IF;
 label:=CASE p_purpose WHEN 'friend' THEN 'IPO custody · '||left(label,14)||' · '||left(p_applicant::text,8) WHEN 'escrow' THEN 'IPO application escrow' ELSE 'IPO proceeds awaiting settlement' END;
 INSERT INTO public.accounts(user_id,name,description,opening_balance,opening_balance_date,is_liability) VALUES(u,label,'IPO-managed custody asset; not available bank cash',0,'1900-01-01',false) RETURNING id INTO a;
 INSERT INTO public.ipo_cash_accounts(user_id,purpose,applicant_id,account_id) VALUES(u,p_purpose,p_applicant,a);
 RETURN a;
END $$;
CREATE FUNCTION public.ipo_balance(p_account uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(sum(CASE WHEN transaction_kind='income' AND account_id=p_account THEN amount WHEN transaction_kind='expense' AND account_id=p_account THEN -amount WHEN transaction_kind='transfer' THEN CASE WHEN account_id=p_account THEN -amount ELSE amount END ELSE 0 END),0)
 FROM public.transactions WHERE (account_id=p_account OR to_account_id=p_account) AND user_id=auth.uid()
$$;
CREATE FUNCTION public.ipo_post(p_event uuid,p_kind text,p_amount numeric,p_date date,p_account uuid,p_to uuid DEFAULT NULL,p_investment uuid DEFAULT NULL,p_name text DEFAULT 'IPO movement') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t uuid; c uuid; r uuid; u uuid:=public.ipo_require_owner(); managed uuid;
BEGIN
 IF p_amount=0 THEN RETURN NULL; END IF;
 IF p_amount<0 THEN RAISE EXCEPTION 'Amount must be positive.'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE id IN (p_account,p_to) AND p_date<opening_balance_date) THEN RAISE EXCEPTION 'A cash movement cannot precede the account opening balance date.'; END IF;
 SELECT id INTO t FROM public.transaction_types WHERE user_id=u AND name='IPO '||p_kind AND kind=p_kind AND is_active AND deleted_at IS NULL;
 IF t IS NULL THEN INSERT INTO public.transaction_types(user_id,name,kind) VALUES(u,'IPO '||p_kind,p_kind) RETURNING id INTO t; END IF;
 IF p_kind<>'transfer' THEN c:=public.ensure_investment_category(t); END IF;
 INSERT INTO public.transactions(user_id,name,transaction_type_id,category_id,amount,transaction_date,account_id,to_account_id,transaction_source,investment_id,ipo_event_id)
 VALUES(u,left(p_name,60),t,c,p_amount,p_date,p_account,p_to,'investment',p_investment,p_event) RETURNING id INTO r;
 FOR managed IN SELECT account_id FROM public.ipo_cash_accounts WHERE account_id IN(p_account,p_to) AND user_id=u LOOP
  IF EXISTS(SELECT 1 FROM (
   SELECT sum(delta) OVER(ORDER BY movement_date) balance FROM (
    SELECT transaction_date AS movement_date,sum(CASE WHEN transaction_kind='income' THEN amount WHEN transaction_kind='expense' THEN -amount WHEN account_id=managed THEN -amount ELSE amount END) delta
    FROM public.transactions WHERE user_id=u AND (account_id=managed OR to_account_id=managed) GROUP BY transaction_date
   ) daily
  ) running WHERE balance<0) THEN RAISE EXCEPTION 'This date would make IPO custody funds negative. Check the funding and receipt dates.'; END IF;
 END LOOP;
 RETURN r;
END $$;

CREATE FUNCTION public.ipo_protect_finance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE protected boolean:=false; internal boolean; record_owner uuid;
BEGIN
 IF TG_TABLE_NAME='account_shares' THEN record_owner:=NEW.owner_id;
 ELSIF TG_OP='DELETE' THEN record_owner:=OLD.user_id;
 ELSE record_owner:=NEW.user_id; END IF;
 SELECT EXISTS(SELECT 1 FROM public.ipo_write_context WHERE transaction_id=txid_current() AND user_id=record_owner) INTO internal;
 IF internal THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_TABLE_NAME='transactions' THEN
  -- Existing rename triggers may refresh labels, but never economic fields.
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['account_name','to_account_name','transaction_type_name','category_name'])=(to_jsonb(OLD)-ARRAY['account_name','to_account_name','transaction_type_name','category_name']) THEN RETURN NEW; END IF;
  protected:=CASE WHEN TG_OP='INSERT' THEN NEW.ipo_event_id IS NOT NULL ELSE OLD.ipo_event_id IS NOT NULL END;
  IF TG_OP<>'DELETE' THEN protected:=protected OR NEW.ipo_event_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.ipo_cash_accounts WHERE account_id IN(NEW.account_id,NEW.to_account_id)); END IF;
  IF TG_OP<>'INSERT' THEN protected:=protected OR EXISTS(SELECT 1 FROM public.ipo_allotments WHERE investment_id=OLD.investment_id); END IF;
  IF TG_OP<>'DELETE' THEN protected:=protected OR EXISTS(SELECT 1 FROM public.ipo_allotments WHERE investment_id=NEW.investment_id); END IF;
 ELSIF TG_TABLE_NAME='investments' THEN
  protected:=EXISTS(SELECT 1 FROM public.ipo_allotments WHERE investment_id=OLD.id);
 ELSIF TG_TABLE_NAME='accounts' THEN
  protected:=EXISTS(SELECT 1 FROM public.ipo_cash_accounts WHERE account_id=OLD.id);
 ELSIF TG_TABLE_NAME='account_shares' THEN
  protected:=EXISTS(SELECT 1 FROM public.ipo_cash_accounts WHERE account_id=NEW.account_id);
 END IF;
 IF protected THEN RAISE EXCEPTION 'This record is managed by IPO. Use the IPO history and correction workflow.'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER ipo_protect_transactions BEFORE INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.ipo_protect_finance();
CREATE TRIGGER ipo_protect_investments BEFORE UPDATE OR DELETE ON public.investments FOR EACH ROW EXECUTE FUNCTION public.ipo_protect_finance();
CREATE TRIGGER ipo_protect_accounts BEFORE UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.ipo_protect_finance();
CREATE TRIGGER ipo_no_custody_sharing BEFORE INSERT OR UPDATE ON public.account_shares FOR EACH ROW EXECUTE FUNCTION public.ipo_protect_finance();

REVOKE ALL ON FUNCTION public.ipo_require_owner(),public.ipo_cash_account(text,uuid),public.ipo_balance(uuid),public.ipo_post(uuid,text,numeric,date,uuid,uuid,uuid,text),public.ipo_protect_finance() FROM PUBLIC,anon,authenticated;
COMMIT;
