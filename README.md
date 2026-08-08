# Phonefix ERP

Multi-shop retail management system for Phonefix — billing, inventory, purchasing,
suppliers, finance, HR, investor tracking, and SMS marketing.

Built with React 19 + Vite + Supabase.

## Setup

1. `npm install`
2. Create a Supabase project and set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `.env`
3. `npm run dev` to start locally, `npm run build` for production

## Deployment

Configured for Netlify (`netlify.toml`). Includes a serverless function for SMS
sending via text.lk (`netlify/functions/send-sms.js`) — set `TEXTLK_API_TOKEN`
and `TEXTLK_SENDER_ID` in your Netlify environment variables.
