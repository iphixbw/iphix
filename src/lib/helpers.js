import { supabase } from '../supabase'

export async function generateInvoiceNo() {
  const { data, error } = await supabase.rpc('generate_invoice_no')
  if (error) throw error
  return data
}

export async function generateCustomerNo() {
  const { data, error } = await supabase.rpc('generate_customer_no')
  if (error) throw error
  return data
}

export async function generateSalesmanNo() {
  const { data, error } = await supabase.rpc('generate_salesman_no')
  if (error) throw error
  return data
}

export async function generateSupplierNo() {
  const { data, error } = await supabase.rpc('generate_supplier_no')
  if (error) throw error
  return data
}

export async function generateItemNo() {
  const { data, error } = await supabase.rpc('generate_item_no')
  if (error) throw error
  return data
}

export function formatCurrency(amount) {
  return `LKR ${parseFloat(amount || 0).toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

export function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
