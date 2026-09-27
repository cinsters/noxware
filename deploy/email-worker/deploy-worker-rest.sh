#!/data/data/com.termux/files/usr/bin/bash
# Deploy the email worker WITHOUT wrangler (wrangler cannot run on Android —
# it needs the `workerd` native binary, which has no android-arm64 build).
#
# Uses the Cloudflare REST API directly with curl. postal-mime is uploaded as
# an additional ES module so no bundler is needed.
#
# One-time setup:
#   1. Cloudflare dashboard → My Profile → API Tokens → Create Token →
#      template "Edit Cloudflare Workers" → copy the token.
#   2. Run:  ./deploy-worker-rest.sh <API_TOKEN>
#      (token is used for this session only; it is not stored)
#
# After deploying: Email → Email Routing → Routing rules → Catch-all →
# Send to Worker → noxware-mail-inbound, and set the secret:
#   ./deploy-worker-rest.sh <API_TOKEN> --secret   (interactive prompt)

set -euo pipefail

TOKEN="${1:?Usage: $0 <CLOUDFLARE_API_TOKEN> [--secret]}"
MODE="${2:-deploy}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKER_NAME="noxware-mail-inbound"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cf() { # $1 method, $2 path, $3 json body (optional)
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -fsS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "Authorization: Bearer $TOKEN"
  fi
}

echo "==> Resolving account id from the noxware.cc zone"
ACCOUNT_ID=$(cf GET "/zones?name=noxware.cc" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d);
    if(!j.success||!j.result?.length){
      console.error('Token cannot see the noxware.cc zone.');
      console.error('Create the token from the Cloudflare account that owns the zone,');
      console.error('using the Edit Cloudflare Workers template with Zone Resources = noxware.cc.');
      process.exit(1)
    }
    console.log(j.result[0].account.id);
  })")
echo "    account: $ACCOUNT_ID"

if [ "$MODE" = "--secret" ]; then
  echo "==> Setting INBOUND_SECRET (input hidden — paste the MAIL_INBOUND_SECRET value)"
  read -rs SECRET
  cf PUT "/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" \
    "{\"name\":\"INBOUND_SECRET\",\"text\":\"$SECRET\",\"type\":\"secret_text\"}" > /dev/null
  echo "    secret set."
  exit 0
fi

echo "==> Preparing modules (worker + postal-mime as ES module)"
# postal-mime ships CJS and ESM builds; Workers module upload needs the ESM one.
node - "$SCRIPT_DIR" "$TMP" <<'EOF'
const [scriptDir, tmp] = process.argv.slice(2)
const fs = require('fs')
const candidates = [
  `${scriptDir}/node_modules/postal-mime/dist/postal-mime.mjs`,
  `${scriptDir}/node_modules/postal-mime/dist/postal-mime.js`,
]
const esm = candidates.find((p) => fs.existsSync(p))
if (!esm) {
  console.error('postal-mime not installed — run: npm i postal-mime --ignore-scripts')
  process.exit(1)
}
const content = fs.readFileSync(esm, 'utf8')
if (!/export\s+(default|\{)/.test(content)) {
  console.error(`${esm} is not an ES module — expected the ESM build of postal-mime`)
  process.exit(1)
}
fs.writeFileSync(`${tmp}/postal-mime.js`, content)
EOF
cp "$SCRIPT_DIR/index.js" "$TMP/worker.js"

METADATA='{"main_module":"worker.js","compatibility_date":"2026-01-15","bindings":[{"type":"plain_text","name":"API_URL","text":"https://noxware.cc/api/mail/inbound"}],"migrations":{}}'

echo "==> Uploading $WORKER_NAME"
curl -fsS -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME" \
  -H "Authorization: Bearer $TOKEN" \
  -F "metadata=$METADATA;type=application/json" \
  -F "worker.js=@$TMP/worker.js;type=application/javascript+module" \
  -F "postal-mime.js=@$TMP/postal-mime.js;type=application/javascript+module" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.success){console.error(j.errors);process.exit(1)};console.log('    uploaded ok')})"

echo "==> Done. Remaining manual steps:"
echo "    1. Set the secret:   ./deploy-worker-rest.sh <TOKEN> --secret"
echo "    2. Dashboard → Email → Email Routing → Routing rules → Catch-all →"
echo "       Send to Worker → noxware-mail-inbound"
echo "    3. Test: email support@noxware.cc from an account address, watch:"
echo "       tail -f ~/noxware/logs/api.log"
