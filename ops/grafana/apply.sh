#!/usr/bin/env bash
# Push the datasources and dashboards in this directory into a Grafana instance.
#
# Grafana here runs from the stock image, so it cannot read provisioning files
# off disk — Railway only attaches a GitHub repo when a service is created, and
# rebuilding this one would cost its public URL. So the files stay the source of
# truth and this script applies them over the HTTP API. It is idempotent: uids
# are fixed, so re-running updates in place rather than duplicating.
#
#   GRAFANA_URL=https://… GRAFANA_AUTH=admin:password ops/grafana/apply.sh
set -euo pipefail

: "${GRAFANA_URL:?set GRAFANA_URL, e.g. https://grafana-production-8bfc.up.railway.app}"
: "${GRAFANA_AUTH:?set GRAFANA_AUTH as user:password}"

here="$(cd "$(dirname "$0")" && pwd)"

echo "→ datasources"
python3 "$here/datasources.py" | while IFS= read -r payload; do
  name=$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
  uid=$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["uid"])')
  # Create, or update in place when that uid already exists
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "$GRAFANA_AUTH" -X POST \
    -H 'content-type: application/json' -d "$payload" "$GRAFANA_URL/api/datasources")
  if [ "$code" = "409" ]; then
    id=$(curl -s -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/datasources/uid/$uid" \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
    code=$(curl -s -o /dev/null -w '%{http_code}' -u "$GRAFANA_AUTH" -X PUT \
      -H 'content-type: application/json' -d "$payload" "$GRAFANA_URL/api/datasources/$id")
  fi
  echo "   $name ($uid) → $code"
done

echo "→ dashboards"
for file in "$here"/dashboards/*.json; do
  payload=$(python3 -c '
import json, sys
dashboard = json.load(open(sys.argv[1]))
dashboard.pop("id", None)
print(json.dumps({"dashboard": dashboard, "overwrite": True}))' "$file")
  status=$(curl -s -u "$GRAFANA_AUTH" -X POST -H 'content-type: application/json' \
    -d "$payload" "$GRAFANA_URL/api/dashboards/db" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status", d.get("message","?")))')
  echo "   $(basename "$file") → $status"
done
