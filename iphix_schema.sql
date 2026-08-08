--
-- PostgreSQL database dump
--

\restrict viSjWhqc2VSLItkpJOGW3ODwtpwAPqp6Mf7Ehy0tUsgJEb8bZtqeoDJQJAyMa71

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_item_stock(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_item_stock(p_item_id uuid, p_quantity numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  update items set stock_quantity = coalesce(stock_quantity, 0) + p_quantity
  where id = p_item_id;
end $$;


--
-- Name: adjust_customer_balance(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_customer_balance(p_customer_id uuid, p_delta numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  update customers set credit_balance = coalesce(credit_balance, 0) + p_delta
  where id = p_customer_id;
end $$;


--
-- Name: adjust_supplier_balance(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_supplier_balance(p_supplier_id uuid, p_delta numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  update suppliers set outstanding_balance = coalesce(outstanding_balance, 0) + p_delta
  where id = p_supplier_id;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_no text NOT NULL,
    shop_id uuid,
    customer_id uuid,
    cash_customer boolean DEFAULT false,
    salesman_id uuid,
    status text DEFAULT 'draft'::text,
    subtotal numeric DEFAULT 0,
    discount_percent numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    total numeric DEFAULT 0,
    payment_method text,
    amount_paid numeric DEFAULT 0,
    credit_amount numeric DEFAULT 0,
    cheque_no text,
    cheque_date date,
    cheque_bank_id uuid,
    cheque_bank_name text,
    stock_deducted boolean DEFAULT false,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: create_invoice_with_items(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_invoice_with_items(p_invoice jsonb, p_items jsonb) RETURNS SETOF public.invoices
    LANGUAGE plpgsql
    AS $$
declare
  new_invoice invoices;
  item jsonb;
begin
  insert into invoices (
    invoice_no, shop_id, customer_id, salesman_id, status, payment_method,
    amount_paid, discount_percent, discount_amount, subtotal, total,
    credit_amount, notes, cash_customer, cheque_no, cheque_date, cheque_bank_name,
    created_at
  )
  values (
    p_invoice->>'invoice_no',
    (p_invoice->>'shop_id')::uuid,
    (p_invoice->>'customer_id')::uuid,
    (p_invoice->>'salesman_id')::uuid,
    coalesce(p_invoice->>'status', 'confirmed'),
    p_invoice->>'payment_method',
    coalesce((p_invoice->>'amount_paid')::numeric, 0),
    coalesce((p_invoice->>'discount_percent')::numeric, 0),
    coalesce((p_invoice->>'discount_amount')::numeric, 0),
    coalesce((p_invoice->>'subtotal')::numeric, 0),
    coalesce((p_invoice->>'total')::numeric, 0),
    coalesce((p_invoice->>'credit_amount')::numeric, 0),
    p_invoice->>'notes',
    coalesce((p_invoice->>'cash_customer')::boolean, false),
    p_invoice->>'cheque_no',
    (p_invoice->>'cheque_date')::date,
    p_invoice->>'cheque_bank_name',
    now()
  )
  returning * into new_invoice;

  for item in select * from jsonb_array_elements(p_items)
  loop
    insert into invoice_items (
      invoice_id, item_id, quantity, unit_price, discount_percent, line_total,
      warranty, immi_no, is_free_issue, is_third_party, created_at
    )
    values (
      new_invoice.id,
      (item->>'item_id')::uuid,
      (item->>'quantity')::numeric,
      (item->>'unit_price')::numeric,
      coalesce((item->>'discount_percent')::numeric, 0),
      (item->>'line_total')::numeric,
      item->>'warranty',
      item->>'immi_no',
      coalesce((item->>'is_free_issue')::boolean, false),
      coalesce((item->>'is_third_party')::boolean, false),
      now()
    );
  end loop;

  return next new_invoice;
end $$;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_no text NOT NULL,
    supplier_id uuid,
    shop_id uuid,
    status text DEFAULT 'confirmed'::text,
    subtotal numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    total numeric DEFAULT 0,
    payment_method text,
    amount_paid numeric DEFAULT 0,
    credit_amount numeric DEFAULT 0,
    remaining_balance numeric DEFAULT 0,
    immi_no text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: create_purchase_with_items(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_purchase_with_items(p_purchase jsonb, p_items jsonb) RETURNS SETOF public.purchases
    LANGUAGE plpgsql
    AS $$
declare
  new_purchase purchases;
  item jsonb;
begin
  insert into purchases (
    purchase_no, supplier_id, shop_id, status, payment_method,
    amount_paid, subtotal, total, credit_amount, notes, immi_no,
    created_at
  )
  values (
    p_purchase->>'purchase_no',
    (p_purchase->>'supplier_id')::uuid,
    (p_purchase->>'shop_id')::uuid,
    coalesce(p_purchase->>'status', 'confirmed'),
    p_purchase->>'payment_method',
    coalesce((p_purchase->>'amount_paid')::numeric, 0),
    coalesce((p_purchase->>'subtotal')::numeric, 0),
    coalesce((p_purchase->>'total')::numeric, 0),
    coalesce((p_purchase->>'credit_amount')::numeric, 0),
    p_purchase->>'notes',
    p_purchase->>'immi_no',
    now()
  )
  returning * into new_purchase;

  for item in select * from jsonb_array_elements(p_items)
  loop
    insert into purchase_items (
      purchase_id, item_id, quantity, unit_cost, line_total, is_free_issue, immi_no, created_at
    )
    values (
      new_purchase.id,
      (item->>'item_id')::uuid,
      (item->>'quantity')::numeric,
      (item->>'unit_cost')::numeric,
      (item->>'line_total')::numeric,
      coalesce((item->>'is_free_issue')::boolean, false),
      item->>'immi_no',
      now()
    );
  end loop;

  return next new_purchase;
end $$;


--
-- Name: deduct_item_stock(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deduct_item_stock(p_item_id uuid, p_quantity numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  available numeric;
begin
  select stock_quantity into available from items where id = p_item_id for update;
  if available is null then
    raise exception 'Item % not found', p_item_id;
  end if;
  if available - p_quantity < 0 then
    raise exception 'Insufficient stock for item % — available %, requested %', p_item_id, available, p_quantity;
  end if;
  update items set stock_quantity = available - p_quantity where id = p_item_id;
end $$;


--
-- Name: deduct_shop_inventory(uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deduct_shop_inventory(p_item_id uuid, p_shop_id uuid, p_quantity numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  remaining numeric := p_quantity;
  batch record;
  take numeric;
begin
  for batch in
    select * from inventory
    where item_id = p_item_id and shop_id = p_shop_id and quantity > 0
    order by received_at asc
    for update
  loop
    exit when remaining <= 0;
    take := least(remaining, batch.quantity);
    update inventory set quantity = quantity - take where id = batch.id;
    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    raise exception 'Insufficient shop inventory for item % at shop % — % units unaccounted for', p_item_id, p_shop_id, remaining;
  end if;
end $$;


--
-- Name: generate_customer_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_customer_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(customer_no from '[0-9]+')::integer), 0) + 1
  into next_no from customers;
  return 'CUS-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_invoice_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_invoice_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(invoice_no from '[0-9]+')::integer), 0) + 1
  into next_no from invoices;
  return 'INV-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_item_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_item_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(item_no from '[0-9]+')::integer), 0) + 1
  into next_no from items;
  return 'ITM-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_purchase_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_purchase_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(purchase_no from '[0-9]+')::integer), 0) + 1
  into next_no from purchases;
  return 'PUR-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_repair_customer_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_repair_customer_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(customer_no from '[0-9]+')::integer), 0) + 1
  into next_no from repair_customers;
  return 'RC-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_repair_job_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_repair_job_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(job_no from '[0-9]+')::integer), 0) + 1
  into next_no from repair_jobs;
  return 'RJ-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_repair_part_sku(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_repair_part_sku() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(sku from '[0-9]+')::integer), 0) + 1
  into next_no from repair_parts;
  return 'RPT-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_repair_purchase_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_repair_purchase_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(purchase_no from '[0-9]+')::integer), 0) + 1
  into next_no from repair_purchases;
  return 'RP-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_repair_return_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_repair_return_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(return_no from '[0-9]+')::integer), 0) + 1
  into next_no from repair_purchase_returns;
  return 'RPR-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_repair_sale_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_repair_sale_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(sale_no from '[0-9]+')::integer), 0) + 1
  into next_no from repair_sales;
  return 'RSL-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_repair_supplier_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_repair_supplier_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(supplier_no from '[0-9]+')::integer), 0) + 1
  into next_no from repair_suppliers;
  return 'RS-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_return_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_return_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(return_no from '[0-9]+')::integer), 0) + 1
  into next_no from sales_returns;
  return 'SR-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_return_no_purchase(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_return_no_purchase() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(return_no from '[0-9]+')::integer), 0) + 1
  into next_no from purchase_returns;
  return 'PR-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_salesman_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_salesman_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(salesman_no from '[0-9]+')::integer), 0) + 1
  into next_no from salesmen;
  return 'SM-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_supplier_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_supplier_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(supplier_no from '[0-9]+')::integer), 0) + 1
  into next_no from suppliers;
  return 'SUP-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_transfer_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_transfer_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare next_no integer;
begin
  select coalesce(max(substring(transfer_no from '[0-9]+')::integer), 0) + 1
  into next_no from stock_transfers;
  return 'ST-' || lpad(next_no::text, 5, '0');
end $$;


--
-- Name: generate_warranty_claim_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_warranty_claim_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  n int;
begin
  n := nextval('warranty_claim_no_seq');
  return 'WC-' || lpad(n::text, 5, '0');
end $$;


--
-- Name: recalculate_all_customer_balances(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_all_customer_balances() RETURNS TABLE(cust_id uuid, old_balance numeric, new_balance numeric)
    LANGUAGE plpgsql
    AS $$
declare
  cust record;
  calc_balance numeric;
  inv record;
  pay record;
  tx record;
  ret record;
begin
  for cust in select id, name, opening_balance, credit_balance from customers loop
    calc_balance := coalesce(cust.opening_balance, 0);

    for inv in
      select invoices.id, invoices.total, invoices.amount_paid from invoices
      where invoices.customer_id = cust.id and invoices.status = 'confirmed'
    loop
      -- Full invoice total is the debit
      calc_balance := calc_balance + coalesce(inv.total, 0);
      -- Amount paid at time of invoice creation is a credit
      if coalesce(inv.amount_paid, 0) > 0 then
        calc_balance := calc_balance - inv.amount_paid;
      end if;

      -- Every subsequent non-returned payment is a credit. A returned cheque never
      -- actually paid anything, so it's skipped entirely rather than subtracted then
      -- added back — the invoice's full total (added above) already represents the
      -- debt; adding the cheque amount back on top of never having subtracted it
      -- would double-count that debt.
      for pay in
        select invoice_payments.amount, invoice_payments.cheque_status from invoice_payments
        where invoice_payments.invoice_id = inv.id
      loop
        if coalesce(pay.cheque_status, '') <> 'returned' then
          calc_balance := calc_balance - pay.amount;
        end if;
      end loop;
    end loop;

    -- Direct opening-balance bank/cash payments (identified by note text,
    -- matching the convention used in Customers.jsx) — a returned one adds back.
    -- Uses the direct invoice_payment_id link (reliable) rather than an amount/
    -- timestamp guess, which breaks for any cheque split across multiple invoices.
    for tx in
      select bank_transactions.id, bank_transactions.amount, bank_transactions.notes, bank_transactions.invoice_payment_id
      from bank_transactions
      where bank_transactions.reference ilike '%' || cust.name || '%'
        and bank_transactions.type in ('deposit', 'cheque_in')
    loop
      if tx.invoice_payment_id is null then
        -- A returned cheque never actually paid anything — skip entirely rather
        -- than adding back. It was never subtracted in the first place (this loop
        -- only subtracts on the non-returned branch below), so "adding back" here
        -- would create new debt rather than simply un-crediting a payment.
        if not (tx.notes ilike '%[RETURNED]%') and tx.notes ilike '%Opening balance%' then
          calc_balance := calc_balance - tx.amount;
        end if;
      elsif not (tx.notes ilike '%[RETURNED]%') then
        -- Linked, still active — sum EVERY invoice_payments row tied to this
        -- transaction (a FIFO-split cheque can settle several invoices at once,
        -- not just one — a single-row lookup here would treat every invoice
        -- beyond the first as an "overpayment remainder" and double-count it).
        -- Only the genuine excess over that total is real customer credit.
        declare
          linked_total numeric;
        begin
          select coalesce(sum(invoice_payments.amount), 0) into linked_total
          from invoice_payments where invoice_payments.bank_transaction_id = tx.id;
          if linked_total < tx.amount then
            calc_balance := calc_balance - (tx.amount - linked_total);
          end if;
        end;
      end if;
      -- If linked AND returned: do nothing. The invoice-linked portion was never
      -- subtracted (invoice_payments loop above skips returned rows), and any
      -- remainder credit was never real once the cheque bounced — "skip entirely"
      -- is correct for both parts, matching the non-linked case.
    end loop;

    -- Credit-method sales returns reduce what's owed (cash refunds don't)
    for ret in
      select sales_returns.total from sales_returns
      where sales_returns.customer_id = cust.id and sales_returns.status = 'confirmed'
        and (sales_returns.payment_method = 'credit' or sales_returns.payment_method is null)
    loop
      calc_balance := calc_balance - coalesce(ret.total, 0);
    end loop;

    if abs(coalesce(cust.credit_balance, 0) - calc_balance) > 0.01 then
      update customers set credit_balance = calc_balance where id = cust.id;
      cust_id := cust.id;
      old_balance := cust.credit_balance;
      new_balance := calc_balance;
      return next;
    end if;
  end loop;
end $$;


--
-- Name: repair_add_part_stock(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_add_part_stock(p_part_id uuid, p_quantity numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  update repair_parts set current_stock = coalesce(current_stock, 0) + p_quantity
  where id = p_part_id;
end $$;


--
-- Name: repair_adjust_customer_balance(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_adjust_customer_balance(p_customer_id uuid, p_delta numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  update repair_customers set outstanding_balance = coalesce(outstanding_balance, 0) + p_delta
  where id = p_customer_id;
end $$;


--
-- Name: repair_adjust_supplier_balance(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_adjust_supplier_balance(p_supplier_id uuid, p_delta numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  update repair_suppliers set outstanding_balance = greatest(0, coalesce(outstanding_balance, 0) + p_delta)
  where id = p_supplier_id;
end $$;


--
-- Name: repair_deduct_part_stock(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_deduct_part_stock(p_part_id uuid, p_quantity numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  update repair_parts set current_stock = greatest(0, coalesce(current_stock, 0) - p_quantity)
  where id = p_part_id;
end $$;


--
-- Name: repair_bank_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_bank_deposits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    bank_account_id uuid,
    amount numeric NOT NULL,
    deposit_date date DEFAULT CURRENT_DATE NOT NULL,
    reference text,
    remarks text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_deposit_to_bank(uuid, uuid, numeric, text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_deposit_to_bank(p_shop_id uuid, p_bank_account_id uuid, p_amount numeric, p_reference text, p_remarks text, p_deposit_date date) RETURNS SETOF public.repair_bank_deposits
    LANGUAGE plpgsql
    AS $$
declare
  new_deposit repair_bank_deposits;
begin
  insert into repair_bank_deposits (shop_id, bank_account_id, amount, deposit_date, reference, remarks)
  values (p_shop_id, p_bank_account_id, p_amount, p_deposit_date, p_reference, p_remarks)
  returning * into new_deposit;

  -- Decrease repair cash
  insert into repair_cash_ledger (shop_id, type, amount, reference, notes)
  values (p_shop_id, 'deposit', -p_amount, p_reference, 'Deposited to bank: ' || coalesce(p_remarks, ''));

  -- Increase the retail bank account (existing table — the one integration point)
  update bank_accounts set balance = coalesce(balance, 0) + p_amount where id = p_bank_account_id;

  -- Record on the retail side too, so it shows in existing Bank Transactions history
  insert into bank_transactions (bank_account_id, type, amount, reference, notes)
  values (p_bank_account_id, 'deposit', p_amount, coalesce(p_reference, 'Repair division deposit'), 'From Repair Division cash · ' || coalesce(p_remarks, ''));

  return next new_deposit;
end $$;


--
-- Name: repair_fifo_add_batch(uuid, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_fifo_add_batch(p_part_id uuid, p_purchase_id uuid, p_quantity numeric, p_unit_cost numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  insert into repair_part_batches (part_id, purchase_id, quantity_remaining, unit_cost)
  values (p_part_id, p_purchase_id, p_quantity, p_unit_cost);
end $$;


--
-- Name: repair_fifo_consume(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_fifo_consume(p_part_id uuid, p_quantity numeric) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
declare
  remaining numeric := p_quantity;
  batch record;
  take numeric;
  total_cost numeric := 0;
begin
  for batch in
    select * from repair_part_batches
    where part_id = p_part_id and quantity_remaining > 0
    order by created_at asc
    for update
  loop
    exit when remaining <= 0;
    take := least(remaining, batch.quantity_remaining);
    total_cost := total_cost + take * batch.unit_cost;
    update repair_part_batches set quantity_remaining = quantity_remaining - take where id = batch.id;
    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    raise exception 'Not enough FIFO stock batches for part % — % units unaccounted for', p_part_id, remaining;
  end if;

  return total_cost / nullif(p_quantity, 0);
end $$;


--
-- Name: repair_fifo_return(uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_fifo_return(p_part_id uuid, p_quantity numeric, p_unit_cost numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  insert into repair_part_batches (part_id, purchase_id, quantity_remaining, unit_cost)
  values (p_part_id, null, p_quantity, p_unit_cost);
end $$;


--
-- Name: repair_fifo_stock_value(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_fifo_stock_value(p_part_id uuid) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  select coalesce(sum(quantity_remaining * unit_cost), 0)
  from repair_part_batches
  where part_id = p_part_id and quantity_remaining > 0
$$;


--
-- Name: repair_job_timeline_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_job_timeline_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if TG_OP = 'INSERT' then
    insert into repair_job_timeline (job_id, event, created_by)
    values (new.id, 'Job created — status: ' || new.status, new.created_by);
  elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
    insert into repair_job_timeline (job_id, event)
    values (new.id, 'Status changed: ' || old.status || ' → ' || new.status);
  end if;
  return new;
end $$;


--
-- Name: return_customer_cheque(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.return_customer_cheque(p_invoice_payment_id uuid, p_bank_transaction_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_amount numeric;
  v_customer_id uuid;
  v_ip_id uuid := p_invoice_payment_id;
  v_bt_id uuid := p_bank_transaction_id;
begin
  -- Resolve whichever id wasn't passed in, via the link column
  if v_ip_id is null and v_bt_id is not null then
    select invoice_payment_id into v_ip_id from bank_transactions where id = v_bt_id;
  end if;
  if v_bt_id is null and v_ip_id is not null then
    select bank_transaction_id into v_bt_id from invoice_payments where id = v_ip_id;
  end if;

  if v_ip_id is not null then
    select amount into v_amount from invoice_payments where id = v_ip_id;
    select invoices.customer_id into v_customer_id
    from invoice_payments join invoices on invoices.id = invoice_payments.invoice_id
    where invoice_payments.id = v_ip_id;

    update invoice_payments set
      cheque_status = 'returned',
      returned_at = now(),
      notes = trim(coalesce(notes, '') || ' [RETURNED]')
    where id = v_ip_id;
  end if;

  if v_bt_id is not null then
    if v_amount is null then select amount into v_amount from bank_transactions where id = v_bt_id; end if;
    update bank_transactions set
      cheque_status = 'presented',
      notes = trim(coalesce(notes, '') || ' [RETURNED]')
    where id = v_bt_id;
  end if;

  if v_customer_id is not null and v_amount is not null then
    update customers set credit_balance = coalesce(credit_balance, 0) + v_amount where id = v_customer_id;
  end if;
end $$;


--
-- Name: transfer_stock_between_shops(uuid, uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_stock_between_shops(p_item_id uuid, p_from_shop_id uuid, p_to_shop_id uuid, p_quantity numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  remaining numeric := p_quantity;
  batch record;
  take numeric;
  total_qty numeric := 0;
  total_cost numeric := 0;
  avg_cost numeric := 0;
begin
  -- Lock and walk source-shop batches oldest-first
  for batch in
    select * from inventory
    where item_id = p_item_id and shop_id = p_from_shop_id and quantity > 0
    order by received_at asc
    for update
  loop
    exit when remaining <= 0;
    take := least(remaining, batch.quantity);
    update inventory set quantity = quantity - take where id = batch.id;
    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    raise exception 'Insufficient stock at source shop for item % — % units unaccounted for', p_item_id, remaining;
  end if;

  -- Weighted average cost across whatever remains at the source shop (for the new batch's cost basis)
  select coalesce(sum(quantity), 0), coalesce(sum(quantity * cost_price), 0)
  into total_qty, total_cost
  from inventory where item_id = p_item_id and shop_id = p_from_shop_id;
  avg_cost := case when total_qty > 0 then total_cost / total_qty else 0 end;

  insert into inventory (item_id, shop_id, quantity, cost_price, received_at)
  values (p_item_id, p_to_shop_id, p_quantity, avg_cost, now());
end $$;


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    bank_name text,
    account_no text,
    balance numeric DEFAULT 0,
    shop_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bank_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_account_id uuid,
    shop_id uuid,
    type text NOT NULL,
    amount numeric NOT NULL,
    cheque_no text,
    cheque_date date,
    cheque_status text,
    reference text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    invoice_payment_id uuid,
    purchase_payment_id uuid,
    repair_supplier_payment_id uuid
);


--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cash_deposits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_deposits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_account_id uuid,
    shop_id uuid,
    amount numeric NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cash_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    date date,
    opening_balance numeric DEFAULT 0,
    total_sales numeric DEFAULT 0,
    total_deposits numeric DEFAULT 0,
    closing_balance numeric DEFAULT 0,
    status text DEFAULT 'open'::text,
    closed_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    parent_category_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_no text NOT NULL,
    name text NOT NULL,
    phone text,
    address text,
    credit_balance numeric DEFAULT 0,
    opening_balance numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    category text,
    description text NOT NULL,
    amount numeric NOT NULL,
    payment_method text,
    bank_account_id uuid,
    cheque_no text,
    cheque_date date,
    cheque_presented boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: hr_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid,
    date date NOT NULL,
    shift_start timestamp with time zone,
    shift_end timestamp with time zone,
    start_lat numeric,
    start_lng numeric,
    end_lat numeric,
    end_lng numeric,
    auto_ended boolean DEFAULT false,
    status text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: hr_attendance_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_attendance_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid,
    date date NOT NULL,
    shift_start time without time zone NOT NULL,
    shift_end time without time zone NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: hr_leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid,
    leave_type text NOT NULL,
    date_from date NOT NULL,
    date_to date NOT NULL,
    days integer NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: hr_salary_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_salary_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid,
    amount numeric NOT NULL,
    payment_method text,
    paid_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: hr_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hr_staff (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    name text NOT NULL,
    nic text,
    phone text,
    address text,
    role text,
    monthly_salary numeric,
    salary_paid numeric DEFAULT 0,
    salary_reset_date date,
    shift_start time without time zone,
    shift_end time without time zone,
    shift_days text[],
    geo_lat numeric,
    geo_lng numeric,
    geo_radius_m integer,
    casual_leave_balance integer DEFAULT 0,
    annual_leave_balance integer DEFAULT 0,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid,
    shop_id uuid,
    quantity numeric DEFAULT 0,
    cost_price numeric,
    received_at timestamp with time zone DEFAULT now()
);


--
-- Name: investment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    investor_id uuid,
    type text NOT NULL,
    amount numeric NOT NULL,
    date date NOT NULL,
    payment_method text,
    cheque_no text,
    cheque_date date,
    cheque_bank_name text,
    reference text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: investors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    status text DEFAULT 'active'::text,
    return_type text,
    return_value numeric,
    return_period text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    item_id uuid,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    discount_percent numeric DEFAULT 0,
    line_total numeric NOT NULL,
    is_free_issue boolean DEFAULT false,
    is_third_party boolean DEFAULT false,
    procurement_id uuid,
    warranty text,
    immi_no text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    amount numeric NOT NULL,
    payment_method text,
    bank_account_id uuid,
    cheque_no text,
    cheque_date date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    cheque_status text,
    returned_at timestamp with time zone,
    bank_transaction_id uuid
);


--
-- Name: invoice_profitability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_profitability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_no text,
    shop_id uuid,
    shop_name text,
    customer_id uuid,
    customer_no text,
    customer_name text,
    status text,
    revenue numeric,
    selling_total numeric,
    cost_total numeric,
    gross_profit numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_no text NOT NULL,
    name text NOT NULL,
    barcode text,
    cost_price numeric DEFAULT 0,
    selling_price numeric DEFAULT 0,
    last_price numeric DEFAULT 0,
    stock_quantity numeric DEFAULT 0,
    reorder_level numeric,
    warranty_available boolean DEFAULT false,
    supplier_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    brand_id uuid,
    category_id uuid
);


--
-- Name: purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid,
    item_id uuid,
    quantity numeric NOT NULL,
    unit_cost numeric NOT NULL,
    discount_percent numeric DEFAULT 0,
    line_total numeric NOT NULL,
    is_free_issue boolean DEFAULT false,
    immi_no text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchase_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid,
    amount numeric NOT NULL,
    payment_method text,
    bank_account_id uuid,
    cheque_no text,
    cheque_date date,
    cheque_bank_name text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    cheque_status text,
    returned_at timestamp with time zone,
    bank_transaction_id uuid
);


--
-- Name: purchase_return_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid,
    item_id uuid,
    quantity numeric NOT NULL,
    unit_cost numeric NOT NULL,
    line_total numeric NOT NULL,
    immi_no text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchase_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_no text NOT NULL,
    purchase_id uuid,
    supplier_id uuid,
    shop_id uuid,
    status text DEFAULT 'confirmed'::text,
    subtotal numeric DEFAULT 0,
    total numeric DEFAULT 0,
    payment_method text,
    immi_no text,
    remarks text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchase_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_no text,
    shop_id uuid,
    shop_name text,
    supplier_no text,
    supplier_name text,
    status text,
    payment_method text,
    total numeric,
    amount_paid numeric,
    credit_amount numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_accessory_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_accessory_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_cash_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_cash_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    type text NOT NULL,
    amount numeric NOT NULL,
    reference text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_no text NOT NULL,
    name text NOT NULL,
    mobile text NOT NULL,
    alt_mobile text,
    email text,
    address text,
    created_at timestamp with time zone DEFAULT now(),
    outstanding_balance numeric DEFAULT 0
);


--
-- Name: repair_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    category text,
    description text NOT NULL,
    amount numeric NOT NULL,
    payment_method text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_job_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_job_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    charge_type text NOT NULL,
    description text,
    amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_job_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_job_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    part_id uuid,
    quantity numeric DEFAULT 1 NOT NULL,
    unit_cost numeric DEFAULT 0,
    unit_price numeric NOT NULL,
    discount_percent numeric DEFAULT 0,
    tax_percent numeric DEFAULT 0,
    line_total numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    is_third_party boolean DEFAULT false
);


--
-- Name: repair_job_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_job_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    amount numeric NOT NULL,
    payment_method text NOT NULL,
    bank_account_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_job_timeline; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_job_timeline (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    event text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_no text NOT NULL,
    shop_id uuid,
    customer_id uuid,
    phone_brand text,
    phone_model text,
    imei text,
    serial_no text,
    phone_colour text,
    storage_capacity text,
    passcode text,
    battery_pct_intake integer,
    accessories_received text[],
    phone_condition text[],
    other_condition_notes text,
    reported_problem text,
    detailed_notes text,
    estimated_cost numeric DEFAULT 0,
    estimated_completion date,
    technician text,
    priority text DEFAULT 'medium'::text,
    warranty boolean DEFAULT false,
    warranty_expiry date,
    deposit_received numeric DEFAULT 0,
    balance_due numeric DEFAULT 0,
    parts_total numeric DEFAULT 0,
    labour_total numeric DEFAULT 0,
    other_charges numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    tax_amount numeric DEFAULT 0,
    grand_total numeric DEFAULT 0,
    cost_total numeric DEFAULT 0,
    gross_profit numeric DEFAULT 0,
    net_profit numeric DEFAULT 0,
    status text DEFAULT 'received'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    warranty_duration text,
    voided_at timestamp with time zone,
    void_reason text
);


--
-- Name: repair_part_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_part_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    part_id uuid,
    purchase_id uuid,
    quantity_remaining numeric NOT NULL,
    unit_cost numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    barcode text,
    name text NOT NULL,
    compatible_models text,
    category text,
    brand text,
    supplier_id uuid,
    purchase_price numeric DEFAULT 0,
    average_cost numeric DEFAULT 0,
    selling_price numeric DEFAULT 0,
    min_stock numeric DEFAULT 0,
    current_stock numeric DEFAULT 0,
    location text,
    warranty text,
    expiry_date date,
    notes text,
    shop_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_purchase_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid,
    part_id uuid,
    quantity numeric NOT NULL,
    unit_cost numeric NOT NULL,
    line_total numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_purchase_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_purchase_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_id uuid,
    amount numeric NOT NULL,
    payment_method text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_purchase_return_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_purchase_return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid,
    part_id uuid,
    quantity numeric NOT NULL,
    unit_cost numeric NOT NULL,
    line_total numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_purchase_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_purchase_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_no text NOT NULL,
    purchase_id uuid,
    supplier_id uuid,
    shop_id uuid,
    subtotal numeric DEFAULT 0,
    total numeric DEFAULT 0,
    remarks text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_no text NOT NULL,
    supplier_id uuid,
    shop_id uuid,
    status text DEFAULT 'confirmed'::text,
    subtotal numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    total numeric DEFAULT 0,
    payment_method text,
    amount_paid numeric DEFAULT 0,
    credit_amount numeric DEFAULT 0,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_sale_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_sale_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_id uuid,
    part_id uuid,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    discount_percent numeric DEFAULT 0,
    line_total numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    unit_cost numeric DEFAULT 0
);


--
-- Name: repair_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sale_no text NOT NULL,
    shop_id uuid,
    customer_id uuid,
    customer_name text,
    subtotal numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    tax_amount numeric DEFAULT 0,
    total numeric DEFAULT 0,
    payment_method text,
    amount_paid numeric DEFAULT 0,
    status text DEFAULT 'confirmed'::text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_supplier_payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_supplier_payment_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    purchase_id uuid,
    amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_supplier_standalone_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_supplier_standalone_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid,
    shop_id uuid,
    amount numeric NOT NULL,
    payment_method text NOT NULL,
    bank_account_id uuid,
    reference text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    cheque_no text,
    cheque_date date,
    cheque_status text,
    bank_transaction_id uuid,
    status text DEFAULT 'confirmed'::text,
    CONSTRAINT repair_supplier_standalone_payments_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'returned'::text])))
);


--
-- Name: repair_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_no text NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    opening_balance numeric DEFAULT 0,
    outstanding_balance numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: repair_third_party_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_third_party_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    job_id uuid,
    job_part_id uuid,
    item_name text NOT NULL,
    supplier_name text,
    supplier_phone text,
    quantity numeric DEFAULT 1 NOT NULL,
    cost_price numeric DEFAULT 0,
    selling_price numeric NOT NULL,
    payment_status text DEFAULT 'pending'::text,
    payment_method text,
    paid_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales_return_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_return_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid,
    item_id uuid,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    line_total numeric NOT NULL,
    is_third_party boolean DEFAULT false,
    procurement_id uuid,
    third_party_return_status text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_no text NOT NULL,
    invoice_id uuid,
    shop_id uuid,
    customer_id uuid,
    salesman_id uuid,
    status text DEFAULT 'confirmed'::text,
    subtotal numeric DEFAULT 0,
    total numeric DEFAULT 0,
    payment_method text,
    bank_account_id uuid,
    remarks text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_no text,
    shop_id uuid,
    shop_name text,
    customer_no text,
    customer_name text,
    salesman_name text,
    status text,
    payment_method text,
    subtotal numeric,
    discount_amount numeric,
    total numeric,
    amount_paid numeric,
    credit_amount numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: salesmen; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salesmen (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salesman_no text NOT NULL,
    name text NOT NULL,
    phone text,
    shop_id uuid,
    user_id uuid,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shift_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    salesman_id uuid,
    shift_date date,
    cash_sales numeric DEFAULT 0,
    card_sales numeric DEFAULT 0,
    credit_sales numeric DEFAULT 0,
    cheque_sales numeric DEFAULT 0,
    total_sales numeric DEFAULT 0,
    total_expenses numeric DEFAULT 0,
    expected_cash numeric DEFAULT 0,
    actual_cash numeric DEFAULT 0,
    difference numeric DEFAULT 0,
    auto_eos boolean DEFAULT false,
    notes text,
    closed_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shop_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid,
    shop_id uuid,
    selling_price numeric,
    last_price numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    cash_in_hand numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sms_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient text NOT NULL,
    message text NOT NULL,
    status text,
    reference_type text,
    reference_id uuid,
    triggered_by text,
    response jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: stock_transfer_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_transfer_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_id uuid,
    item_id uuid,
    quantity numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: stock_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_no text NOT NULL,
    from_shop_id uuid,
    to_shop_id uuid,
    status text DEFAULT 'completed'::text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: supplier_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid,
    shop_id uuid,
    amount numeric NOT NULL,
    payment_method text,
    bank_account_id uuid,
    cheque_no text,
    cheque_date date,
    cheque_presented boolean DEFAULT false,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_no text NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    opening_balance numeric DEFAULT 0,
    outstanding_balance numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: third_party_procurement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.third_party_procurement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    item_id uuid,
    item_name text,
    supplier_name text,
    supplier_phone text,
    quantity numeric,
    cost_price numeric,
    selling_price numeric,
    invoice_id uuid,
    invoice_item_id uuid,
    payment_status text DEFAULT 'pending'::text,
    payment_method text,
    paid_at timestamp with time zone,
    reference text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: third_party_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.third_party_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id uuid,
    name text NOT NULL,
    phone text,
    use_count integer DEFAULT 0,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    full_name text,
    role text DEFAULT 'admin'::text,
    shop_id uuid,
    active_shop_id uuid,
    phone text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    shop_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: warranty_claim_no_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warranty_claim_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warranty_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warranty_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_no text NOT NULL,
    division text NOT NULL,
    shop_id uuid,
    invoice_id uuid,
    invoice_item_id uuid,
    customer_id uuid,
    repair_job_id uuid,
    repair_customer_id uuid,
    defective_item_id uuid,
    defective_part_id uuid,
    defective_description text,
    defect_note text NOT NULL,
    replacement_item_id uuid,
    replacement_part_id uuid,
    quantity numeric DEFAULT 1 NOT NULL,
    status text DEFAULT 'confirmed'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT warranty_claims_division_check CHECK ((division = ANY (ARRAY['retail'::text, 'repair'::text]))),
    CONSTRAINT warranty_claims_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'voided'::text])))
);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: bank_transactions bank_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_pkey PRIMARY KEY (id);


--
-- Name: brands brands_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_name_key UNIQUE (name);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: cash_deposits cash_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_pkey PRIMARY KEY (id);


--
-- Name: cash_register cash_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_register
    ADD CONSTRAINT cash_register_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: customers customers_customer_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_no_key UNIQUE (customer_no);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: hr_attendance hr_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_attendance
    ADD CONSTRAINT hr_attendance_pkey PRIMARY KEY (id);


--
-- Name: hr_attendance_requests hr_attendance_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_attendance_requests
    ADD CONSTRAINT hr_attendance_requests_pkey PRIMARY KEY (id);


--
-- Name: hr_leave_requests hr_leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_leave_requests
    ADD CONSTRAINT hr_leave_requests_pkey PRIMARY KEY (id);


--
-- Name: hr_salary_payments hr_salary_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_salary_payments
    ADD CONSTRAINT hr_salary_payments_pkey PRIMARY KEY (id);


--
-- Name: hr_staff hr_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_staff
    ADD CONSTRAINT hr_staff_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: investment_transactions investment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_transactions
    ADD CONSTRAINT investment_transactions_pkey PRIMARY KEY (id);


--
-- Name: investors investors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investors
    ADD CONSTRAINT investors_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: invoice_profitability invoice_profitability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_profitability
    ADD CONSTRAINT invoice_profitability_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_no_key UNIQUE (invoice_no);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: items items_item_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_item_no_key UNIQUE (item_no);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: purchase_items purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_payments purchase_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_pkey PRIMARY KEY (id);


--
-- Name: purchase_return_items purchase_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_return_items
    ADD CONSTRAINT purchase_return_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_returns purchase_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_pkey PRIMARY KEY (id);


--
-- Name: purchase_returns purchase_returns_return_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_return_no_key UNIQUE (return_no);


--
-- Name: purchase_summary purchase_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_summary
    ADD CONSTRAINT purchase_summary_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_purchase_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_purchase_no_key UNIQUE (purchase_no);


--
-- Name: repair_accessory_options repair_accessory_options_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_accessory_options
    ADD CONSTRAINT repair_accessory_options_name_key UNIQUE (name);


--
-- Name: repair_accessory_options repair_accessory_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_accessory_options
    ADD CONSTRAINT repair_accessory_options_pkey PRIMARY KEY (id);


--
-- Name: repair_bank_deposits repair_bank_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_bank_deposits
    ADD CONSTRAINT repair_bank_deposits_pkey PRIMARY KEY (id);


--
-- Name: repair_cash_ledger repair_cash_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_cash_ledger
    ADD CONSTRAINT repair_cash_ledger_pkey PRIMARY KEY (id);


--
-- Name: repair_customers repair_customers_customer_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_customers
    ADD CONSTRAINT repair_customers_customer_no_key UNIQUE (customer_no);


--
-- Name: repair_customers repair_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_customers
    ADD CONSTRAINT repair_customers_pkey PRIMARY KEY (id);


--
-- Name: repair_expenses repair_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_expenses
    ADD CONSTRAINT repair_expenses_pkey PRIMARY KEY (id);


--
-- Name: repair_job_charges repair_job_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_charges
    ADD CONSTRAINT repair_job_charges_pkey PRIMARY KEY (id);


--
-- Name: repair_job_parts repair_job_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_parts
    ADD CONSTRAINT repair_job_parts_pkey PRIMARY KEY (id);


--
-- Name: repair_job_payments repair_job_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_payments
    ADD CONSTRAINT repair_job_payments_pkey PRIMARY KEY (id);


--
-- Name: repair_job_timeline repair_job_timeline_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_timeline
    ADD CONSTRAINT repair_job_timeline_pkey PRIMARY KEY (id);


--
-- Name: repair_jobs repair_jobs_job_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_jobs
    ADD CONSTRAINT repair_jobs_job_no_key UNIQUE (job_no);


--
-- Name: repair_jobs repair_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_jobs
    ADD CONSTRAINT repair_jobs_pkey PRIMARY KEY (id);


--
-- Name: repair_part_batches repair_part_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_part_batches
    ADD CONSTRAINT repair_part_batches_pkey PRIMARY KEY (id);


--
-- Name: repair_parts repair_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_parts
    ADD CONSTRAINT repair_parts_pkey PRIMARY KEY (id);


--
-- Name: repair_parts repair_parts_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_parts
    ADD CONSTRAINT repair_parts_sku_key UNIQUE (sku);


--
-- Name: repair_purchase_items repair_purchase_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_items
    ADD CONSTRAINT repair_purchase_items_pkey PRIMARY KEY (id);


--
-- Name: repair_purchase_payments repair_purchase_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_payments
    ADD CONSTRAINT repair_purchase_payments_pkey PRIMARY KEY (id);


--
-- Name: repair_purchase_return_items repair_purchase_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_return_items
    ADD CONSTRAINT repair_purchase_return_items_pkey PRIMARY KEY (id);


--
-- Name: repair_purchase_returns repair_purchase_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_returns
    ADD CONSTRAINT repair_purchase_returns_pkey PRIMARY KEY (id);


--
-- Name: repair_purchase_returns repair_purchase_returns_return_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_returns
    ADD CONSTRAINT repair_purchase_returns_return_no_key UNIQUE (return_no);


--
-- Name: repair_purchases repair_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchases
    ADD CONSTRAINT repair_purchases_pkey PRIMARY KEY (id);


--
-- Name: repair_purchases repair_purchases_purchase_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchases
    ADD CONSTRAINT repair_purchases_purchase_no_key UNIQUE (purchase_no);


--
-- Name: repair_sale_items repair_sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sale_items
    ADD CONSTRAINT repair_sale_items_pkey PRIMARY KEY (id);


--
-- Name: repair_sales repair_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sales
    ADD CONSTRAINT repair_sales_pkey PRIMARY KEY (id);


--
-- Name: repair_sales repair_sales_sale_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sales
    ADD CONSTRAINT repair_sales_sale_no_key UNIQUE (sale_no);


--
-- Name: repair_supplier_payment_allocations repair_supplier_payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_payment_allocations
    ADD CONSTRAINT repair_supplier_payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: repair_supplier_standalone_payments repair_supplier_standalone_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_standalone_payments
    ADD CONSTRAINT repair_supplier_standalone_payments_pkey PRIMARY KEY (id);


--
-- Name: repair_suppliers repair_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_suppliers
    ADD CONSTRAINT repair_suppliers_pkey PRIMARY KEY (id);


--
-- Name: repair_suppliers repair_suppliers_supplier_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_suppliers
    ADD CONSTRAINT repair_suppliers_supplier_no_key UNIQUE (supplier_no);


--
-- Name: repair_third_party_items repair_third_party_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_third_party_items
    ADD CONSTRAINT repair_third_party_items_pkey PRIMARY KEY (id);


--
-- Name: sales_return_items sales_return_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_return_items
    ADD CONSTRAINT sales_return_items_pkey PRIMARY KEY (id);


--
-- Name: sales_returns sales_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_pkey PRIMARY KEY (id);


--
-- Name: sales_returns sales_returns_return_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_return_no_key UNIQUE (return_no);


--
-- Name: sales_summary sales_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_summary
    ADD CONSTRAINT sales_summary_pkey PRIMARY KEY (id);


--
-- Name: salesmen salesmen_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesmen
    ADD CONSTRAINT salesmen_pkey PRIMARY KEY (id);


--
-- Name: salesmen salesmen_salesman_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesmen
    ADD CONSTRAINT salesmen_salesman_no_key UNIQUE (salesman_no);


--
-- Name: shift_records shift_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_records
    ADD CONSTRAINT shift_records_pkey PRIMARY KEY (id);


--
-- Name: shop_prices shop_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_prices
    ADD CONSTRAINT shop_prices_pkey PRIMARY KEY (id);


--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);


--
-- Name: sms_log sms_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer_items stock_transfer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id);


--
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);


--
-- Name: stock_transfers stock_transfers_transfer_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_transfer_no_key UNIQUE (transfer_no);


--
-- Name: supplier_payments supplier_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_supplier_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_supplier_no_key UNIQUE (supplier_no);


--
-- Name: third_party_procurement third_party_procurement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_procurement
    ADD CONSTRAINT third_party_procurement_pkey PRIMARY KEY (id);


--
-- Name: third_party_suppliers third_party_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_suppliers
    ADD CONSTRAINT third_party_suppliers_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: user_shops user_shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_shops
    ADD CONSTRAINT user_shops_pkey PRIMARY KEY (id);


--
-- Name: warranty_claims warranty_claims_claim_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_claim_no_key UNIQUE (claim_no);


--
-- Name: warranty_claims warranty_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_pkey PRIMARY KEY (id);


--
-- Name: idx_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_parent ON public.categories USING btree (parent_category_id);


--
-- Name: idx_categories_unique_subcat; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_categories_unique_subcat ON public.categories USING btree (name, parent_category_id) WHERE (parent_category_id IS NOT NULL);


--
-- Name: idx_categories_unique_toplevel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_categories_unique_toplevel ON public.categories USING btree (name) WHERE (parent_category_id IS NULL);


--
-- Name: idx_customers_customer_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_customer_no ON public.customers USING btree (customer_no);


--
-- Name: idx_hr_attendance_staff_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hr_attendance_staff_id ON public.hr_attendance USING btree (staff_id);


--
-- Name: idx_invoice_items_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_items_invoice_id ON public.invoice_items USING btree (invoice_id);


--
-- Name: idx_invoice_payments_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_invoice_id ON public.invoice_payments USING btree (invoice_id);


--
-- Name: idx_invoices_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_created_at ON public.invoices USING btree (created_at);


--
-- Name: idx_invoices_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_customer_id ON public.invoices USING btree (customer_id);


--
-- Name: idx_invoices_shop_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_shop_id ON public.invoices USING btree (shop_id);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_items_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_barcode ON public.items USING btree (barcode);


--
-- Name: idx_items_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_brand_id ON public.items USING btree (brand_id);


--
-- Name: idx_items_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_items_category_id ON public.items USING btree (category_id);


--
-- Name: idx_purchase_items_purchase_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_items_purchase_id ON public.purchase_items USING btree (purchase_id);


--
-- Name: idx_purchases_shop_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchases_shop_id ON public.purchases USING btree (shop_id);


--
-- Name: idx_purchases_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchases_supplier_id ON public.purchases USING btree (supplier_id);


--
-- Name: idx_repair_batches_part; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_batches_part ON public.repair_part_batches USING btree (part_id, created_at);


--
-- Name: idx_repair_cash_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_cash_created ON public.repair_cash_ledger USING btree (created_at);


--
-- Name: idx_repair_cash_shop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_cash_shop ON public.repair_cash_ledger USING btree (shop_id);


--
-- Name: idx_repair_customers_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_customers_mobile ON public.repair_customers USING btree (mobile);


--
-- Name: idx_repair_customers_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_customers_no ON public.repair_customers USING btree (customer_no);


--
-- Name: idx_repair_job_charges_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_job_charges_job ON public.repair_job_charges USING btree (job_id);


--
-- Name: idx_repair_job_parts_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_job_parts_job ON public.repair_job_parts USING btree (job_id);


--
-- Name: idx_repair_jobs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_jobs_created ON public.repair_jobs USING btree (created_at);


--
-- Name: idx_repair_jobs_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_jobs_customer ON public.repair_jobs USING btree (customer_id);


--
-- Name: idx_repair_jobs_imei; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_jobs_imei ON public.repair_jobs USING btree (imei);


--
-- Name: idx_repair_jobs_shop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_jobs_shop ON public.repair_jobs USING btree (shop_id);


--
-- Name: idx_repair_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_jobs_status ON public.repair_jobs USING btree (status);


--
-- Name: idx_repair_parts_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_parts_barcode ON public.repair_parts USING btree (barcode);


--
-- Name: idx_repair_parts_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_parts_category ON public.repair_parts USING btree (category);


--
-- Name: idx_repair_parts_shop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_parts_shop ON public.repair_parts USING btree (shop_id);


--
-- Name: idx_repair_parts_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_parts_sku ON public.repair_parts USING btree (sku);


--
-- Name: idx_repair_pay_alloc_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_pay_alloc_payment ON public.repair_supplier_payment_allocations USING btree (payment_id);


--
-- Name: idx_repair_pay_alloc_purchase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_pay_alloc_purchase ON public.repair_supplier_payment_allocations USING btree (purchase_id);


--
-- Name: idx_repair_timeline_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_timeline_job ON public.repair_job_timeline USING btree (job_id);


--
-- Name: idx_sales_returns_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_returns_invoice_id ON public.sales_returns USING btree (invoice_id);


--
-- Name: idx_suppliers_supplier_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_supplier_no ON public.suppliers USING btree (supplier_no);


--
-- Name: idx_warranty_claims_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warranty_claims_customer ON public.warranty_claims USING btree (customer_id);


--
-- Name: idx_warranty_claims_division; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warranty_claims_division ON public.warranty_claims USING btree (division);


--
-- Name: idx_warranty_claims_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warranty_claims_invoice ON public.warranty_claims USING btree (invoice_id);


--
-- Name: idx_warranty_claims_repair_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warranty_claims_repair_customer ON public.warranty_claims USING btree (repair_customer_id);


--
-- Name: idx_warranty_claims_repair_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warranty_claims_repair_job ON public.warranty_claims USING btree (repair_job_id);


--
-- Name: repair_jobs trg_repair_job_timeline; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_repair_job_timeline AFTER INSERT OR UPDATE ON public.repair_jobs FOR EACH ROW EXECUTE FUNCTION public.repair_job_timeline_trigger();


--
-- Name: bank_accounts bank_accounts_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: bank_transactions bank_transactions_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: bank_transactions bank_transactions_invoice_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_invoice_payment_id_fkey FOREIGN KEY (invoice_payment_id) REFERENCES public.invoice_payments(id);


--
-- Name: bank_transactions bank_transactions_purchase_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_purchase_payment_id_fkey FOREIGN KEY (purchase_payment_id) REFERENCES public.purchase_payments(id);


--
-- Name: bank_transactions bank_transactions_repair_supplier_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_repair_supplier_payment_id_fkey FOREIGN KEY (repair_supplier_payment_id) REFERENCES public.repair_supplier_standalone_payments(id);


--
-- Name: bank_transactions bank_transactions_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_transactions
    ADD CONSTRAINT bank_transactions_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: cash_deposits cash_deposits_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: cash_deposits cash_deposits_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_deposits
    ADD CONSTRAINT cash_deposits_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: cash_register cash_register_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_register
    ADD CONSTRAINT cash_register_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id);


--
-- Name: cash_register cash_register_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_register
    ADD CONSTRAINT cash_register_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: categories categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: expenses expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: expenses expenses_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: hr_attendance_requests hr_attendance_requests_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_attendance_requests
    ADD CONSTRAINT hr_attendance_requests_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.hr_staff(id) ON DELETE CASCADE;


--
-- Name: hr_attendance hr_attendance_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_attendance
    ADD CONSTRAINT hr_attendance_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.hr_staff(id) ON DELETE CASCADE;


--
-- Name: hr_leave_requests hr_leave_requests_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_leave_requests
    ADD CONSTRAINT hr_leave_requests_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.hr_staff(id) ON DELETE CASCADE;


--
-- Name: hr_salary_payments hr_salary_payments_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_salary_payments
    ADD CONSTRAINT hr_salary_payments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.hr_staff(id) ON DELETE CASCADE;


--
-- Name: hr_staff hr_staff_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hr_staff
    ADD CONSTRAINT hr_staff_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: inventory inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: inventory inventory_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: investment_transactions investment_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_transactions
    ADD CONSTRAINT investment_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: investment_transactions investment_transactions_investor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_transactions
    ADD CONSTRAINT investment_transactions_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.investors(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: invoice_payments invoice_payments_bank_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_bank_transaction_id_fkey FOREIGN KEY (bank_transaction_id) REFERENCES public.bank_transactions(id);


--
-- Name: invoice_payments invoice_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: invoice_payments invoice_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_profitability invoice_profitability_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_profitability
    ADD CONSTRAINT invoice_profitability_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: invoice_profitability invoice_profitability_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_profitability
    ADD CONSTRAINT invoice_profitability_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: invoices invoices_salesman_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_salesman_id_fkey FOREIGN KEY (salesman_id) REFERENCES public.salesmen(id);


--
-- Name: invoices invoices_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: items items_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: items items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;


--
-- Name: items items_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchase_items purchase_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: purchase_items purchase_items_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchase_payments purchase_payments_bank_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_bank_transaction_id_fkey FOREIGN KEY (bank_transaction_id) REFERENCES public.bank_transactions(id);


--
-- Name: purchase_payments purchase_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: purchase_payments purchase_payments_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchase_return_items purchase_return_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_return_items
    ADD CONSTRAINT purchase_return_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: purchase_return_items purchase_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_return_items
    ADD CONSTRAINT purchase_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.purchase_returns(id) ON DELETE CASCADE;


--
-- Name: purchase_returns purchase_returns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: purchase_returns purchase_returns_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);


--
-- Name: purchase_returns purchase_returns_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: purchase_returns purchase_returns_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchase_summary purchase_summary_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_summary
    ADD CONSTRAINT purchase_summary_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: purchases purchases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: purchases purchases_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: purchases purchases_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: repair_bank_deposits repair_bank_deposits_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_bank_deposits
    ADD CONSTRAINT repair_bank_deposits_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: repair_bank_deposits repair_bank_deposits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_bank_deposits
    ADD CONSTRAINT repair_bank_deposits_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_bank_deposits repair_bank_deposits_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_bank_deposits
    ADD CONSTRAINT repair_bank_deposits_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_cash_ledger repair_cash_ledger_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_cash_ledger
    ADD CONSTRAINT repair_cash_ledger_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_cash_ledger repair_cash_ledger_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_cash_ledger
    ADD CONSTRAINT repair_cash_ledger_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_expenses repair_expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_expenses
    ADD CONSTRAINT repair_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_expenses repair_expenses_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_expenses
    ADD CONSTRAINT repair_expenses_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_job_charges repair_job_charges_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_charges
    ADD CONSTRAINT repair_job_charges_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.repair_jobs(id) ON DELETE CASCADE;


--
-- Name: repair_job_parts repair_job_parts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_parts
    ADD CONSTRAINT repair_job_parts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.repair_jobs(id) ON DELETE CASCADE;


--
-- Name: repair_job_parts repair_job_parts_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_parts
    ADD CONSTRAINT repair_job_parts_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.repair_parts(id);


--
-- Name: repair_job_payments repair_job_payments_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_payments
    ADD CONSTRAINT repair_job_payments_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: repair_job_payments repair_job_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_payments
    ADD CONSTRAINT repair_job_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_job_payments repair_job_payments_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_payments
    ADD CONSTRAINT repair_job_payments_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.repair_jobs(id) ON DELETE CASCADE;


--
-- Name: repair_job_timeline repair_job_timeline_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_timeline
    ADD CONSTRAINT repair_job_timeline_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_job_timeline repair_job_timeline_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_job_timeline
    ADD CONSTRAINT repair_job_timeline_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.repair_jobs(id) ON DELETE CASCADE;


--
-- Name: repair_jobs repair_jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_jobs
    ADD CONSTRAINT repair_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_jobs repair_jobs_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_jobs
    ADD CONSTRAINT repair_jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.repair_customers(id);


--
-- Name: repair_jobs repair_jobs_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_jobs
    ADD CONSTRAINT repair_jobs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_part_batches repair_part_batches_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_part_batches
    ADD CONSTRAINT repair_part_batches_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.repair_parts(id) ON DELETE CASCADE;


--
-- Name: repair_part_batches repair_part_batches_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_part_batches
    ADD CONSTRAINT repair_part_batches_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.repair_purchases(id);


--
-- Name: repair_parts repair_parts_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_parts
    ADD CONSTRAINT repair_parts_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_parts repair_parts_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_parts
    ADD CONSTRAINT repair_parts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.repair_suppliers(id);


--
-- Name: repair_purchase_items repair_purchase_items_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_items
    ADD CONSTRAINT repair_purchase_items_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.repair_parts(id);


--
-- Name: repair_purchase_items repair_purchase_items_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_items
    ADD CONSTRAINT repair_purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.repair_purchases(id) ON DELETE CASCADE;


--
-- Name: repair_purchase_payments repair_purchase_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_payments
    ADD CONSTRAINT repair_purchase_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_purchase_payments repair_purchase_payments_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_payments
    ADD CONSTRAINT repair_purchase_payments_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.repair_purchases(id) ON DELETE CASCADE;


--
-- Name: repair_purchase_return_items repair_purchase_return_items_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_return_items
    ADD CONSTRAINT repair_purchase_return_items_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.repair_parts(id);


--
-- Name: repair_purchase_return_items repair_purchase_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_return_items
    ADD CONSTRAINT repair_purchase_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.repair_purchase_returns(id) ON DELETE CASCADE;


--
-- Name: repair_purchase_returns repair_purchase_returns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_returns
    ADD CONSTRAINT repair_purchase_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_purchase_returns repair_purchase_returns_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_returns
    ADD CONSTRAINT repair_purchase_returns_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.repair_purchases(id);


--
-- Name: repair_purchase_returns repair_purchase_returns_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_returns
    ADD CONSTRAINT repair_purchase_returns_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_purchase_returns repair_purchase_returns_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchase_returns
    ADD CONSTRAINT repair_purchase_returns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.repair_suppliers(id);


--
-- Name: repair_purchases repair_purchases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchases
    ADD CONSTRAINT repair_purchases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_purchases repair_purchases_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchases
    ADD CONSTRAINT repair_purchases_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_purchases repair_purchases_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_purchases
    ADD CONSTRAINT repair_purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.repair_suppliers(id);


--
-- Name: repair_sale_items repair_sale_items_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sale_items
    ADD CONSTRAINT repair_sale_items_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.repair_parts(id);


--
-- Name: repair_sale_items repair_sale_items_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sale_items
    ADD CONSTRAINT repair_sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.repair_sales(id) ON DELETE CASCADE;


--
-- Name: repair_sales repair_sales_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sales
    ADD CONSTRAINT repair_sales_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_sales repair_sales_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sales
    ADD CONSTRAINT repair_sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.repair_customers(id);


--
-- Name: repair_sales repair_sales_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_sales
    ADD CONSTRAINT repair_sales_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_supplier_payment_allocations repair_supplier_payment_allocations_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_payment_allocations
    ADD CONSTRAINT repair_supplier_payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.repair_supplier_standalone_payments(id) ON DELETE CASCADE;


--
-- Name: repair_supplier_payment_allocations repair_supplier_payment_allocations_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_payment_allocations
    ADD CONSTRAINT repair_supplier_payment_allocations_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.repair_purchases(id) ON DELETE CASCADE;


--
-- Name: repair_supplier_standalone_payments repair_supplier_standalone_payments_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_standalone_payments
    ADD CONSTRAINT repair_supplier_standalone_payments_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: repair_supplier_standalone_payments repair_supplier_standalone_payments_bank_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_standalone_payments
    ADD CONSTRAINT repair_supplier_standalone_payments_bank_transaction_id_fkey FOREIGN KEY (bank_transaction_id) REFERENCES public.bank_transactions(id);


--
-- Name: repair_supplier_standalone_payments repair_supplier_standalone_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_standalone_payments
    ADD CONSTRAINT repair_supplier_standalone_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_supplier_standalone_payments repair_supplier_standalone_payments_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_standalone_payments
    ADD CONSTRAINT repair_supplier_standalone_payments_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: repair_supplier_standalone_payments repair_supplier_standalone_payments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_supplier_standalone_payments
    ADD CONSTRAINT repair_supplier_standalone_payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.repair_suppliers(id);


--
-- Name: repair_third_party_items repair_third_party_items_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_third_party_items
    ADD CONSTRAINT repair_third_party_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: repair_third_party_items repair_third_party_items_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_third_party_items
    ADD CONSTRAINT repair_third_party_items_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.repair_jobs(id);


--
-- Name: repair_third_party_items repair_third_party_items_job_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_third_party_items
    ADD CONSTRAINT repair_third_party_items_job_part_id_fkey FOREIGN KEY (job_part_id) REFERENCES public.repair_job_parts(id);


--
-- Name: repair_third_party_items repair_third_party_items_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_third_party_items
    ADD CONSTRAINT repair_third_party_items_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: sales_return_items sales_return_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_return_items
    ADD CONSTRAINT sales_return_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: sales_return_items sales_return_items_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_return_items
    ADD CONSTRAINT sales_return_items_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.sales_returns(id) ON DELETE CASCADE;


--
-- Name: sales_returns sales_returns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: sales_returns sales_returns_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: sales_returns sales_returns_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: sales_returns sales_returns_salesman_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_salesman_id_fkey FOREIGN KEY (salesman_id) REFERENCES public.salesmen(id);


--
-- Name: sales_returns sales_returns_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_returns
    ADD CONSTRAINT sales_returns_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: sales_summary sales_summary_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_summary
    ADD CONSTRAINT sales_summary_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: salesmen salesmen_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesmen
    ADD CONSTRAINT salesmen_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: salesmen salesmen_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salesmen
    ADD CONSTRAINT salesmen_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: shift_records shift_records_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_records
    ADD CONSTRAINT shift_records_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id);


--
-- Name: shift_records shift_records_salesman_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_records
    ADD CONSTRAINT shift_records_salesman_id_fkey FOREIGN KEY (salesman_id) REFERENCES public.salesmen(id);


--
-- Name: shift_records shift_records_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_records
    ADD CONSTRAINT shift_records_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: shop_prices shop_prices_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_prices
    ADD CONSTRAINT shop_prices_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;


--
-- Name: shop_prices shop_prices_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_prices
    ADD CONSTRAINT shop_prices_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: sms_log sms_log_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: stock_transfer_items stock_transfer_items_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: stock_transfer_items stock_transfer_items_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE CASCADE;


--
-- Name: stock_transfers stock_transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: stock_transfers stock_transfers_from_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_from_shop_id_fkey FOREIGN KEY (from_shop_id) REFERENCES public.shops(id);


--
-- Name: stock_transfers stock_transfers_to_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_to_shop_id_fkey FOREIGN KEY (to_shop_id) REFERENCES public.shops(id);


--
-- Name: supplier_payments supplier_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: supplier_payments supplier_payments_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: supplier_payments supplier_payments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: third_party_procurement third_party_procurement_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_procurement
    ADD CONSTRAINT third_party_procurement_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: third_party_procurement third_party_procurement_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_procurement
    ADD CONSTRAINT third_party_procurement_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: third_party_procurement third_party_procurement_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_procurement
    ADD CONSTRAINT third_party_procurement_invoice_item_id_fkey FOREIGN KEY (invoice_item_id) REFERENCES public.invoice_items(id);


--
-- Name: third_party_procurement third_party_procurement_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_procurement
    ADD CONSTRAINT third_party_procurement_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: third_party_procurement third_party_procurement_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_procurement
    ADD CONSTRAINT third_party_procurement_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: third_party_suppliers third_party_suppliers_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.third_party_suppliers
    ADD CONSTRAINT third_party_suppliers_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: user_profiles user_profiles_active_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_active_shop_id_fkey FOREIGN KEY (active_shop_id) REFERENCES public.shops(id);


--
-- Name: user_profiles user_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: user_shops user_shops_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_shops
    ADD CONSTRAINT user_shops_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;


--
-- Name: user_shops user_shops_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_shops
    ADD CONSTRAINT user_shops_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: warranty_claims warranty_claims_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: warranty_claims warranty_claims_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: warranty_claims warranty_claims_defective_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_defective_item_id_fkey FOREIGN KEY (defective_item_id) REFERENCES public.items(id);


--
-- Name: warranty_claims warranty_claims_defective_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_defective_part_id_fkey FOREIGN KEY (defective_part_id) REFERENCES public.repair_parts(id);


--
-- Name: warranty_claims warranty_claims_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: warranty_claims warranty_claims_invoice_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_invoice_item_id_fkey FOREIGN KEY (invoice_item_id) REFERENCES public.invoice_items(id);


--
-- Name: warranty_claims warranty_claims_repair_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_repair_customer_id_fkey FOREIGN KEY (repair_customer_id) REFERENCES public.repair_customers(id);


--
-- Name: warranty_claims warranty_claims_repair_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_repair_job_id_fkey FOREIGN KEY (repair_job_id) REFERENCES public.repair_jobs(id);


--
-- Name: warranty_claims warranty_claims_replacement_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_replacement_item_id_fkey FOREIGN KEY (replacement_item_id) REFERENCES public.items(id);


--
-- Name: warranty_claims warranty_claims_replacement_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_replacement_part_id_fkey FOREIGN KEY (replacement_part_id) REFERENCES public.repair_parts(id);


--
-- Name: warranty_claims warranty_claims_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warranty_claims
    ADD CONSTRAINT warranty_claims_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id);


--
-- Name: bank_accounts authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.bank_accounts TO authenticated USING (true) WITH CHECK (true);


--
-- Name: bank_transactions authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.bank_transactions TO authenticated USING (true) WITH CHECK (true);


--
-- Name: cash_deposits authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.cash_deposits TO authenticated USING (true) WITH CHECK (true);


--
-- Name: cash_register authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.cash_register TO authenticated USING (true) WITH CHECK (true);


--
-- Name: customers authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.customers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: expenses authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.expenses TO authenticated USING (true) WITH CHECK (true);


--
-- Name: hr_attendance authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.hr_attendance TO authenticated USING (true) WITH CHECK (true);


--
-- Name: hr_attendance_requests authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.hr_attendance_requests TO authenticated USING (true) WITH CHECK (true);


--
-- Name: hr_leave_requests authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.hr_leave_requests TO authenticated USING (true) WITH CHECK (true);


--
-- Name: hr_salary_payments authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.hr_salary_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: hr_staff authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.hr_staff TO authenticated USING (true) WITH CHECK (true);


--
-- Name: inventory authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.inventory TO authenticated USING (true) WITH CHECK (true);


--
-- Name: investment_transactions authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.investment_transactions TO authenticated USING (true) WITH CHECK (true);


--
-- Name: investors authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.investors TO authenticated USING (true) WITH CHECK (true);


--
-- Name: invoice_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.invoice_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: invoice_payments authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.invoice_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: invoice_profitability authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.invoice_profitability TO authenticated USING (true) WITH CHECK (true);


--
-- Name: invoices authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.invoices TO authenticated USING (true) WITH CHECK (true);


--
-- Name: items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.purchase_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_payments authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.purchase_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_return_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.purchase_return_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_returns authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.purchase_returns TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_summary authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.purchase_summary TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchases authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.purchases TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_bank_deposits authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_bank_deposits TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_cash_ledger authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_cash_ledger TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_customers authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_customers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_expenses authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_expenses TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_job_charges authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_job_charges TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_job_parts authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_job_parts TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_job_payments authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_job_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_job_timeline authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_job_timeline TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_jobs authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_jobs TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_part_batches authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_part_batches TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_parts authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_parts TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_purchase_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_purchase_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_purchase_payments authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_purchase_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_purchase_return_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_purchase_return_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_purchase_returns authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_purchase_returns TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_purchases authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_purchases TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_sale_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_sale_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_sales authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_sales TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_supplier_standalone_payments authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_supplier_standalone_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_suppliers authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_suppliers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: repair_third_party_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.repair_third_party_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: sales_return_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.sales_return_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: sales_returns authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.sales_returns TO authenticated USING (true) WITH CHECK (true);


--
-- Name: sales_summary authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.sales_summary TO authenticated USING (true) WITH CHECK (true);


--
-- Name: salesmen authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.salesmen TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shift_records authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.shift_records TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shop_prices authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.shop_prices TO authenticated USING (true) WITH CHECK (true);


--
-- Name: shops authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.shops TO authenticated USING (true) WITH CHECK (true);


--
-- Name: sms_log authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.sms_log TO authenticated USING (true) WITH CHECK (true);


--
-- Name: stock_transfer_items authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.stock_transfer_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: stock_transfers authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.stock_transfers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: supplier_payments authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.supplier_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: suppliers authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.suppliers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: third_party_procurement authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.third_party_procurement TO authenticated USING (true) WITH CHECK (true);


--
-- Name: third_party_suppliers authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.third_party_suppliers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: user_profiles authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.user_profiles TO authenticated USING (true) WITH CHECK (true);


--
-- Name: user_shops authenticated_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_full_access ON public.user_shops TO authenticated USING (true) WITH CHECK (true);


--
-- Name: bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_deposits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_deposits ENABLE ROW LEVEL SECURITY;

--
-- Name: cash_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_register ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: hr_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hr_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: hr_attendance_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hr_attendance_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: hr_leave_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hr_leave_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: hr_salary_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hr_salary_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: hr_staff; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hr_staff ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: investment_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investment_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: investors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_profitability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_profitability ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_return_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_bank_deposits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_bank_deposits ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_cash_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_cash_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_job_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_job_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_job_parts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_job_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_job_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_job_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_job_timeline; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_job_timeline ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_part_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_part_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_parts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_purchase_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_purchase_items ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_purchase_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_purchase_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_purchase_return_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_purchase_return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_purchase_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_purchase_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_sale_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_sale_items ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_supplier_standalone_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_supplier_standalone_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: repair_third_party_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.repair_third_party_items ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_return_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: salesmen; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.salesmen ENABLE ROW LEVEL SECURITY;

--
-- Name: shift_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shift_records ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shop_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: shops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_transfer_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: third_party_procurement; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.third_party_procurement ENABLE ROW LEVEL SECURITY;

--
-- Name: third_party_suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.third_party_suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_shops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_shops ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict viSjWhqc2VSLItkpJOGW3ODwtpwAPqp6Mf7Ehy0tUsgJEb8bZtqeoDJQJAyMa71

