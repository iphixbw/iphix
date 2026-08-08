/**
 * Netlify Function: send-sms
 * Uses text.lk HTTP API to send SMS messages.
 *
 * Required environment variables — set in Netlify dashboard:
 *   TEXTLK_API_TOKEN  — your API Token from text.lk profile page
 *   TEXTLK_SENDER_ID  — your approved Sender ID (e.g. "Phonefix")
 *
 * text.lk HTTP API endpoint: https://app.text.lk/api/v3/sms/send
 * Docs: https://text.lk/docs/send-sms/
 */

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const { to, message } = body

  if (!to || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing to or message' }) }
  }

  const apiToken = process.env.TEXTLK_API_TOKEN
  const senderId = process.env.TEXTLK_SENDER_ID

  if (!apiToken || !senderId) {
    console.error('Missing env vars: TEXTLK_API_TOKEN or TEXTLK_SENDER_ID')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SMS not configured. Add TEXTLK_API_TOKEN and TEXTLK_SENDER_ID in Netlify environment variables.' }),
    }
  }

  try {
    const response = await fetch('https://app.text.lk/api/v3/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        recipient: to,          // e.g. "94771234567" — no + prefix
        sender_id: senderId,    // your approved sender name
        type: 'plain',
        message: message,
      }),
    })

    const data = await response.json()
    console.log('text.lk response:', JSON.stringify(data))

    if (response.ok && data.status === 'success') {
      return { statusCode: 200, body: JSON.stringify({ success: true, data }) }
    } else {
      console.error('text.lk error:', data)
      return {
        statusCode: 200,
        body: JSON.stringify({ success: false, error: data?.message || 'SMS send failed', data }),
      }
    }
  } catch (err) {
    console.error('send-sms function error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
