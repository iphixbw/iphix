-- ============================================================
-- Repair Division — Migration: FIFO costing
-- Replaces average_cost with proper FIFO cost layers.
-- Run this in Supabase SQL Editor AFTER repair_division_schema.sql
-- and repair_customer_credit_migration.sql.
-- ============================================================

-- Each row is one "batch" of stock at a specific cost — created on every
-- purchase (and on initial stock entry). Consumed oldest-first (FIFO) when
-- parts are used in a job or sold, via repair_fifo_consume() below.
create table repair_part_batches (
  id uuid primary key default gen_random_uuid(),
  part_id uuid references repair_parts(id) on delete cascade,
  purchase_id uuid references repair_purchases(id),
  quantity_remaining numeric not null,
  unit_cost numeric not null,
  created_at timestamptz default now()
);

create index idx_repair_batches_part on repair_part_batches(part_id, created_at);

-- Consumes `p_quantity` units of a part FIFO-first, returns the weighted
-- average cost of what was consumed (for recording on job_parts/sale_items).
-- Raises an exception if there isn't enough stock in batches to cover it.
create or replace function repair_fifo_consume(p_part_id uuid, p_quantity numeric)
returns numeric language plpgsql as $$
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

-- Adds a new FIFO batch (called on purchase confirm, or manual stock entry).
create or replace function repair_fifo_add_batch(p_part_id uuid, p_purchase_id uuid, p_quantity numeric, p_unit_cost numeric)
returns void language plpgsql as $$
begin
  insert into repair_part_batches (part_id, purchase_id, quantity_remaining, unit_cost)
  values (p_part_id, p_purchase_id, p_quantity, p_unit_cost);
end $$;

-- Reverses a consumption (e.g. removing a part from a job) by adding stock
-- back as a new batch at the given cost — simplest correct FIFO reversal
-- without needing to reconstruct which exact batches were drawn from.
create or replace function repair_fifo_return(p_part_id uuid, p_quantity numeric, p_unit_cost numeric)
returns void language plpgsql as $$
begin
  insert into repair_part_batches (part_id, purchase_id, quantity_remaining, unit_cost)
  values (p_part_id, null, p_quantity, p_unit_cost);
end $$;

-- Current FIFO stock value for a part (sum of remaining batch quantities × cost)
create or replace function repair_fifo_stock_value(p_part_id uuid)
returns numeric language sql as $$
  select coalesce(sum(quantity_remaining * unit_cost), 0) from repair_part_batches where part_id = p_part_id;
$$;

-- ============================================================
-- Backfill: turn each repair_part's existing current_stock into one
-- opening batch at its current average_cost, so FIFO has something to
-- consume from immediately. Safe to run once; skips parts with 0 stock.
-- ============================================================

insert into repair_part_batches (part_id, purchase_id, quantity_remaining, unit_cost)
select id, null, current_stock, coalesce(average_cost, 0)
from repair_parts
where current_stock > 0;

-- ============================================================
-- Auto-generate SKU for new repair parts (item 2)
-- ============================================================

create or replace function generate_repair_part_sku()
returns text language plpgsql as $$
declare next_no integer;
begin
  select coalesce(max(substring(sku from '[0-9]+')::integer), 0) + 1
  into next_no from repair_parts;
  return 'RPT-' || lpad(next_no::text, 5, '0');
end $$;

-- ============================================================
-- Item 6: standalone supplier payments (pay down outstanding
-- balance, not tied to one specific purchase) — cash or bank
-- ============================================================

create table repair_supplier_standalone_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references repair_suppliers(id),
  shop_id uuid references shops(id),
  amount numeric not null,
  payment_method text not null,   -- 'cash' | 'bank'
  bank_account_id uuid references bank_accounts(id),  -- Phonefix retail bank account
  reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ============================================================
-- Item 10: 3rd-party items on repair jobs — parts sourced ad-hoc
-- for a specific job, not carried in repair_parts inventory.
-- Cost/payment can be filled in later once settled with the source.
-- ============================================================

create table repair_third_party_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id),
  job_id uuid references repair_jobs(id),
  job_part_id uuid references repair_job_parts(id),
  item_name text not null,
  supplier_name text,
  supplier_phone text,
  quantity numeric not null default 1,
  cost_price numeric default 0,
  selling_price numeric not null,
  payment_status text default 'pending',   -- 'pending' | 'paid'
  payment_method text,
  paid_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Mark repair_job_parts as possibly third-party, and let part_id be nullable
-- (3rd-party items aren't in repair_parts inventory at all)
alter table repair_job_parts alter column part_id drop not null;
alter table repair_job_parts add column if not exists is_third_party boolean default false;

-- ============================================================
-- Item 7: cash/card/bank collection when completing a job
-- ============================================================

create table repair_job_payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references repair_jobs(id) on delete cascade,
  amount numeric not null,
  payment_method text not null,   -- 'cash' | 'card' | 'bank_transfer'
  bank_account_id uuid references bank_accounts(id),  -- for card/bank_transfer
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ============================================================
-- RLS for all new tables
-- ============================================================

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
      and table_name in ('repair_part_batches', 'repair_supplier_standalone_payments', 'repair_third_party_items', 'repair_job_payments')
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);', t
    );
  end loop;
end $$;

-- ============================================================
-- Track cost on parts sales too, for consistent FIFO profitability
-- reporting alongside repair jobs.
-- ============================================================

alter table repair_sale_items add column if not exists unit_cost numeric default 0;
