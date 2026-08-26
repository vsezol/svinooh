# Build context — the root of the monorepo (railway.json sets dockerfilePath,
# Root Directory = "/"). We simply bake the config into the official image.
FROM grafana/tempo:2.7.1
COPY ops/tempo/tempo.yaml /etc/tempo.yaml

# /var/tempo is a Railway volume, so the image's own directories there are
# shadowed by the mount — Tempo creates its wal/ and blocks/ subdirectories on
# start. Railway mounts volumes as root, and this image runs as uid 10001, so
# the service also sets RAILWAY_RUN_UID=0; without it Tempo cannot write to its
# own storage.
ENTRYPOINT ["/tempo"]
CMD ["-config.file=/etc/tempo.yaml"]

# restart to verify volume persistence
