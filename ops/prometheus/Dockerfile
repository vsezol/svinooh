# Build context — the root of the monorepo (railway.json sets dockerfilePath,
# Root Directory = "/"). We simply bake the config into the official image.
FROM prom/prometheus:v2.54.1
COPY ops/prometheus/prometheus.yml /etc/prometheus/prometheus.yml

# Override the image's default CMD only to add retention caps — but re-list every
# default flag it carried, because a CMD replaces the whole thing. The load-bearing
# one is --storage.tsdb.path=/prometheus: that is the Railway volume, and without
# it the TSDB lands on the container's ephemeral disk and is lost on every restart.
# 3 days OR 384MB, whichever comes first — plenty for one user, and it keeps the
# TSDB head and compaction memory small.
CMD [ \
  "--config.file=/etc/prometheus/prometheus.yml", \
  "--storage.tsdb.path=/prometheus", \
  "--storage.tsdb.retention.time=3d", \
  "--storage.tsdb.retention.size=384MB", \
  "--web.console.libraries=/usr/share/prometheus/console_libraries", \
  "--web.console.templates=/usr/share/prometheus/consoles" \
]
