import { supabase } from '../supabase'

export async function generateRepairJobNo() {
  const { data, error } = await supabase.rpc('generate_repair_job_no')
  if (error) throw error
  return data
}

export async function generateRepairCustomerNo() {
  const { data, error } = await supabase.rpc('generate_repair_customer_no')
  if (error) throw error
  return data
}

export async function generateRepairSupplierNo() {
  const { data, error } = await supabase.rpc('generate_repair_supplier_no')
  if (error) throw error
  return data
}

export async function generateRepairPurchaseNo() {
  const { data, error } = await supabase.rpc('generate_repair_purchase_no')
  if (error) throw error
  return data
}

export async function generateRepairSaleNo() {
  const { data, error } = await supabase.rpc('generate_repair_sale_no')
  if (error) throw error
  return data
}

export async function generateRepairReturnNo() {
  const { data, error } = await supabase.rpc('generate_repair_return_no')
  if (error) throw error
  return data
}

export async function generateRepairPartSku() {
  const { data, error } = await supabase.rpc('generate_repair_part_sku')
  if (error) throw error
  return data
}
