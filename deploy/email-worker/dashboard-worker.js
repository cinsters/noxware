// Dashboard-friendly version of the email worker — ZERO dependencies.
// Use this when creating the worker in the Cloudflare dashboard editor
// (the npm-import version in index.js needs wrangler/bundling; the dashboard
// cannot resolve `postal-mime`).
//
// Setup (all in the dashboard):
//   1. Workers & Pages → Create Worker → name: noxware-mail-inbound → Deploy
//   2. Edit code → paste this file → Deploy
//   3. Worker → Settings → Variables and Secrets → Add:
//        Type: Secret   Name: INBOUND_SECRET   Value: <same as MAIL_INBOUND_SECRET>
//   4. Email → Email Routing → Routing rules → Catch-all → Send to Worker →
//      noxware-mail-inbound
//
// Notes: from/to come from the SMTP envelope (message.from/message.to) —
// exactly what the API's pipeline keys on. Body extraction handles plain,
// multipart/alternative, and quoted-printable; base64-encoded bodies are not
// decoded and will bounce with 422 (rare for real mail clients).

const API_URL = 'https://noxware.cc/api/mail/inbound'

export default {
  async email(message, env, ctx) {
    const rawText = new TextDecoder().decode(await new Response(message.raw).arrayBuffer())
    const { subject, text } = extractBody(rawText)

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Inbound-Secret': env.INBOUND_SECRET,
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        subject,
        text,
      }),
    })

    // Non-2xx tells Email Routing to bounce the message.
    if (!res.ok) {
      console.error('inbound delivery failed', res.status, await res.text().catch(() => ''))
      message.setReject(`Support intake failed (${res.status})`)
    }
  },
}

function extractBody(raw) {
  // Headers/body split at the first empty line (CRLF or LF).
  const crlf = raw.indexOf('\r\n\r\n')
  const lf = raw.indexOf('\n\n')
  const splitAt = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf
  const sepLen = raw[splitAt] === '\r' ? 4 : 2
  const headerBlock = splitAt >= 0 ? raw.slice(0, splitAt) : raw
  let body = splitAt >= 0 ? raw.slice(splitAt + sepLen) : ''

  const subject = (headerBlock.match(/^subject:[ \t]*(.+)$/im) || [])[1]?.trim() || ''
  const contentType = (headerBlock.match(/^content-type:[ \t]*(.+)$/im) || [])[1] || ''

  // Multipart: take the first text/plain part's body.
  if (/multipart/i.test(contentType)) {
    const boundary = (contentType.match(/boundary="?([^";]+)"?/i) || [])[1]
    if (boundary) {
      const parts = body.split('--' + boundary)
      const plain = parts.find((p) => /content-type:[ \t]*text\/plain/i.test(p))
      if (plain) {
        const p1 = plain.indexOf('\r\n\r\n')
        const p2 = plain.indexOf('\n\n')
        const pAt = p1 >= 0 && (p2 < 0 || p1 < p2) ? p1 : p2
        if (pAt >= 0) body = plain.slice(pAt + (plain[pAt] === '\r' ? 4 : 2))
      }
    }
  }

  // Quoted-printable soft decode.
  if (/quoted-printable/i.test(headerBlock)) {
    body = body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  }

  return { subject, text: body.trim() }
}
