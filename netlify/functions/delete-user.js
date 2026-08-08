/**
 * Netlify Function: delete-user
 * Deletes a Supabase auth user using the service role key.
 * The service role key is stored server-side only (never exposed to the browser).
 *
 * Required environment variables — set in Netlify dashboard:
 *   SUPABASE_URL          — your Supabase project URL
 *   SUPABASE_SERVICE_KEY  — your Supabase service role key (NOT the anon key)
 *
 * Called via POST with body: { userId: "<uuid>" }
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

  const { userId } = body
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_KEY')
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Server not configured for user deletion. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to Netlify environment variables.'
      })
    }
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      }
    })

    if (res.ok || res.status === 404) {
      // 404 means user already doesn't exist in auth — treat as success
      return { statusCode: 200, body: JSON.stringify({ success: true }) }
    }

    const errData = await res.json().catch(() => ({}))
    console.error('Supabase auth delete failed:', errData)
    return {
      statusCode: res.status,
      body: JSON.stringify({ error: errData?.message || 'Auth deletion failed' })
    }
  } catch (err) {
    console.error('delete-user function error:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
