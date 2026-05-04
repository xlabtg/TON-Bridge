#!/usr/bin/env sh
# Generate SRI (sha384) hashes for all external scripts used in templates.
# Run this after updating any CDN dependency version to refresh the hashes.
# Usage: sh scripts/generate-sri.sh
set -eu

hash_url() {
  url="$1"
  printf 'sha384-%s' "$(curl -sfL "$url" | openssl dgst -sha384 -binary | openssl base64 -A)"
}

echo "=== SRI hashes for external resources ==="
echo ""
echo "telegram-web-app.js"
echo "  url: https://telegram.org/js/telegram-web-app.js"
echo "  sri: $(hash_url https://telegram.org/js/telegram-web-app.js)"
echo ""
echo "tganalytics.xyz/index.js"
echo "  url: https://tganalytics.xyz/index.js"
echo "  sri: $(hash_url https://tganalytics.xyz/index.js)"
echo ""
echo "ionicons@5.5.2"
echo "  url: https://unpkg.com/ionicons@5.5.2/dist/ionicons/ionicons.js"
echo "  sri: $(hash_url https://unpkg.com/ionicons@5.5.2/dist/ionicons/ionicons.js)"
echo ""
echo "changenow stepper-connector.js (no CORS — SRI not enforced)"
echo "  url: https://changenow.io/embeds/exchange-widget/v2/stepper-connector.js"
echo "  sri: $(hash_url https://changenow.io/embeds/exchange-widget/v2/stepper-connector.js)"
echo ""
echo "Update integrity= attributes in src/_includes/*.njk with the values above."
