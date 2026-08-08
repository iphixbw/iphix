import { supabase } from '../supabase'

/**
 * Record a bank transaction and update account balance
 * @param {string} bankAccountId - UUID of the bank account
 * @param {'deposit'|'withdrawal'} direction - 'deposit' adds, 'withdrawal' deducts
 * @param {number} amount - positive amount
 * @param {string} reference - invoice no, purchase no, etc
 * @param {string} notes - extra description
 */
export async function recordBankMovement({ bankAccountId, direction, amount, reference = '', notes = '' }) {
  if (!bankAccountId || !amount || amount <= 0) return

  const type = direction === 'deposit' ? 'deposit' : 'withdrawal'

  // Get current balance
  const { data: account } = await supabase
    .from('bank_accounts')
    .select('balance')
    .eq('id', bankAccountId)
    .single()

  const currentBalance = account?.balance || 0
  const newBalance = direction === 'deposit'
    ? currentBalance + amount
    : Math.max(0, currentBalance - amount)

  // Record transaction
  await supabase.from('bank_transactions').insert({
    bank_account_id: bankAccountId,
    type,
    amount,
    reference: reference || null,
    notes: notes || null,
  })

  // Update balance
  await supabase.from('bank_accounts').update({ balance: newBalance }).eq('id', bankAccountId)
}

/**
 * Fetch all bank accounts for dropdowns
 */
export async function fetchBankAccounts() {
  const { data } = await supabase.from('bank_accounts').select('*').order('name')
  return data || []
}
