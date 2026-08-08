import { supabase } from '../supabase'

// Send SMS via Netlify function
export async function sendSMS({ to, message, triggeredBy = null, referenceType = null, referenceId = null, userId = null }) {
  // Clean phone number — ensure it starts with 94 (Sri Lanka)
  let phone = to.replace(/\s+/g, '').replace(/^0/, '94').replace(/^\+/, '')
  if (!phone.startsWith('94')) phone = '94' + phone

  try {
    const response = await fetch('/.netlify/functions/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, message }),
    })
    const data = await response.json()
    const success = response.ok && !data.error

    // Log to sms_log table
    await supabase.from('sms_log').insert({
      recipient: phone,
      message,
      status: success ? 'sent' : 'failed',
      response: data,
      triggered_by: triggeredBy,
      reference_type: referenceType,
      reference_id: referenceId,
      created_by: userId,
    })

    return { success, data }
  } catch (e) {
    await supabase.from('sms_log').insert({
      recipient: phone,
      message,
      status: 'failed',
      response: { error: e.message },
      triggered_by: triggeredBy,
      reference_type: referenceType,
      reference_id: referenceId,
      created_by: userId,
    })
    return { success: false, error: e.message }
  }
}

// Pre-built message templates
export const smsTemplates = {
  invoiceConfirmed: (invoiceNo, total, shopName) =>
    `Dear Customer, your invoice ${invoiceNo} for LKR ${parseFloat(total).toLocaleString('en-LK', { minimumFractionDigits: 2 })} has been confirmed. Thank you for shopping at ${shopName}!`,

  invoiceWithOutstanding: (customerName, invoiceNo, invoiceTotal, outstandingTotal, shopName) =>
    `Hi ${customerName}, thank you for your purchase at ${shopName}! Invoice ${invoiceNo}: LKR ${parseFloat(invoiceTotal).toLocaleString('en-LK', { minimumFractionDigits: 2 })}. Total outstanding balance: LKR ${parseFloat(outstandingTotal).toLocaleString('en-LK', { minimumFractionDigits: 2 })}. Thank you!`,

  invoiceFullyPaid: (customerName, invoiceNo, invoiceTotal, shopName) =>
    `Hi ${customerName}, thank you for your purchase at ${shopName}! Invoice ${invoiceNo}: LKR ${parseFloat(invoiceTotal).toLocaleString('en-LK', { minimumFractionDigits: 2 })} — Fully Paid. We appreciate your business!`,

  purchaseConfirmed: (supplierName, purchaseNo, total, outstanding, shopName) =>
    `Dear ${supplierName}, purchase order ${purchaseNo} from ${shopName} has been confirmed. Amount: LKR ${parseFloat(total).toLocaleString('en-LK', { minimumFractionDigits: 2 })}. Outstanding payable: LKR ${parseFloat(outstanding).toLocaleString('en-LK', { minimumFractionDigits: 2 })}. Thank you.`,

  salesReturnConfirmed: (customerName, returnNo, returnTotal, newOutstanding, shopName) =>
    `Hi ${customerName}, your return ${returnNo} of LKR ${parseFloat(returnTotal).toLocaleString('en-LK', { minimumFractionDigits: 2 })} at ${shopName} has been processed. Updated outstanding balance: LKR ${parseFloat(newOutstanding).toLocaleString('en-LK', { minimumFractionDigits: 2 })}. Thank you.`,

  purchaseReturnConfirmed: (supplierName, returnNo, returnTotal, newOutstanding, shopName) =>
    `Dear ${supplierName}, purchase return ${returnNo} of LKR ${parseFloat(returnTotal).toLocaleString('en-LK', { minimumFractionDigits: 2 })} to ${shopName} has been confirmed. Updated outstanding payable: LKR ${parseFloat(newOutstanding).toLocaleString('en-LK', { minimumFractionDigits: 2 })}. Thank you.`,

  paymentReminder: (customerName, amount, shopName) =>
    `Dear ${customerName}, you have an outstanding balance of LKR ${parseFloat(amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })} with ${shopName}. Please settle at your earliest convenience. Thank you.`,

  paymentReceived: (amount, invoiceNo, shopName) =>
    `Dear Customer, we have received your payment of LKR ${parseFloat(amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })} for invoice ${invoiceNo}. Thank you - ${shopName}.`,

  customerPaymentCollected: (customerName, amountPaid, remainingBalance, shopName) =>
    `Hi ${customerName}, we have received your payment of LKR ${parseFloat(amountPaid).toLocaleString('en-LK', { minimumFractionDigits: 2 })} at ${shopName}. ${parseFloat(remainingBalance) > 0 ? `Outstanding balance: LKR ${parseFloat(remainingBalance).toLocaleString('en-LK', { minimumFractionDigits: 2 })}.` : 'Your account is now fully settled.'} Thank you!`,

  salesReturnToCustomer: (customerName, returnNo, returnTotal, refundMethod, remainingBalance, shopName) =>
    `Hi ${customerName}, your sales return ${returnNo} of LKR ${parseFloat(returnTotal).toLocaleString('en-LK', { minimumFractionDigits: 2 })} at ${shopName} has been processed. Refund: ${refundMethod}. ${parseFloat(remainingBalance) > 0 ? `Outstanding balance: LKR ${parseFloat(remainingBalance).toLocaleString('en-LK', { minimumFractionDigits: 2 })}.` : 'Account fully settled.'} Thank you.`,

  supplierPaymentMade: (supplierName, amountPaid, remainingBalance, shopName) =>
    `Dear ${supplierName}, a payment of LKR ${parseFloat(amountPaid).toLocaleString('en-LK', { minimumFractionDigits: 2 })} has been made to your account by ${shopName}. ${parseFloat(remainingBalance) > 0 ? `Remaining payable: LKR ${parseFloat(remainingBalance).toLocaleString('en-LK', { minimumFractionDigits: 2 })}.` : 'Your account is now fully settled.'} Thank you.`,

  balanceStatement: (customerName, amount, shopName) =>
    `Dear ${customerName}, your current outstanding balance at ${shopName} is LKR ${parseFloat(amount).toLocaleString('en-LK', { minimumFractionDigits: 2 })}. Contact us for details.`,
}
