# Build context — the root of the monorepo (railway.json sets dockerfilePath,
# Root Directory = "/"). Grafana with our datasources and dashboards baked in,
# so a fresh container comes up fully configured rather than empty.
FROM grafana/grafana:11.2.0
COPY ops/grafana/provisioning /etc/grafana/provisioning
COPY ops/grafana/dashboards /etc/grafana/dashboards

# build trigger
# rebuild from repo
