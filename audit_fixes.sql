-- ============================================================
-- Phonefix — Data Consistency Audit Fixes
-- Fixes Findings #1 and #4 from the cross-module audit:
--   #1: deduct_item_stock had no floor guard (retail)
--   #4: no atomic supplier-balance RPC existed for repair
-- Findings #2 and #3 are app-code fixes (see accompanying .jsx files),
-- not database changes.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- ── Finding #1: retail stock deduction now guards against going negative ──
-- Raises a clear error instead of silently allowing negative stock, so a
-- race between two concurrent sales on the same low-stock item fails loudly
-- for the second one rather than corrupting the count.
create or replace function deduct_item_stock(p_item_id uuid, p_quantity numeric)
returns void language plpgsql as $$
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

-- ── Finding #4: atomic supplier balance adjustment for the repair division ──
-- Mirrors repair_adjust_customer_balance, which already existed and was
-- already used correctly elsewhere — this fills the missing counterpart.
create or replace function repair_adjust_supplier_balance(p_supplier_id uuid, p_delta numeric)
returns void language plpgsql as $$
begin
  update repair_suppliers set outstanding_balance = greatest(0, coalesce(outstanding_balance, 0) + p_delta)
  where id = p_supplier_id;
end $$;

-- ── Finding #2 fix: repair_deduct_part_stock now floors at zero ──
-- current_stock is a denormalized cache of repair_part_batches (the real
-- FIFO ledger) — repair_fifo_consume already blocks over-consumption at
-- the batch level, so this just prevents the cache from drifting negative.
create or replace function repair_deduct_part_stock(p_part_id uuid, p_quantity numeric)
returns void language plpgsql as $$
begin
  update repair_parts set current_stock = greatest(0, coalesce(current_stock, 0) - p_quantity)
  where id = p_part_id;
end $$;


-- ============================================================
-- DONE. See the accompanying .jsx file replacements for the app-code
-- fixes to Findings #2 and #3, which route stock/batch updates through
-- these and the existing atomic RPCs instead of racy read-then-write.
-- ============================================================

-- ── Finding #3: retail stock transfer — atomic FIFO batch transfer ──
-- Moves quantity from one shop's inventory batches (oldest first) into a
-- new batch at the destination shop, entirely inside one transaction with
-- row locking, instead of the app doing a racy fetch-loop-update in JS.
-- Raises an exception if the source shop doesn't have enough stock.
create or replace function transfer_stock_between_shops(
  p_item_id uuid, p_from_shop_id uuid, p_to_shop_id uuid, p_quantity numeric
)
returns void language plpgsql as $$
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
