# Build context — the root of the monorepo (railway.json sets dockerfilePath,
# Root Directory = "/"). Grafana with our datasources and dashboards baked in,
# so a fresh container comes up fully configured instead of empty.
#
# /var/lib/grafana is a Railway volume (its database: users, preferences, and
# any dashboard edits made in the UI). Railway mounts volumes as root while this
# image runs as uid 472, so the service also sets RAILWAY_RUN_UID=0.
FROM grafana/grafana:11.2.0
COPY ops/grafana/provisioning /etc/grafana/provisioning
COPY ops/grafana/dashboards /etc/grafana/dashboards
