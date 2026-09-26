// Cloudflare Email Worker — the "MX" leg of support intake.
//
// Email Routing delivers mail for *@noxware.cc to this worker; it parses the
// MIME message and POSTs it to the Noxware API ticket pipeline.
//
// Deploy (from deploy/email-worker/):
//   npm init -y && npm i postal-mime
//   npx wrangler secret put INBOUND_SECRET   # same value as MAIL_INBOUND_SECRET on the API
//   npx wrangler deploy
// Then in the Cloudflare dashboard: Email → Email Routing → Catch-all →
// Send to Worker → "noxware-mail-inbound".
import PostalMime from 'postal-mime'

export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).arrayBuffer()
    const parsed = await PostalMime.parse(raw)

    const res = await fetch(env.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Inbound-Secret': env.INBOUND_SECRET,
      },
      body: JSON.stringify({
        from: parsed.from?.address || message.from,
        to: message.to,
        subject: parsed.subject || '',
        text: parsed.text || '',
      }),
    })

    // Non-2xx tells Email Routing to bounce the message.
    if (!res.ok) {
      console.error('inbound delivery failed', res.status, await res.text().catch(() => ''))
      message.setReject(`Support intake failed (${res.status})`)
    }
  },
}
