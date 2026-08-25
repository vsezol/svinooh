# Build context — the root of the monorepo (railway.json sets dockerfilePath,
# Root Directory = "/"). We simply bake the config into the official image.
FROM grafana/tempo:2.7.1
COPY ops/tempo/tempo.yaml /etc/tempo.yaml
# The image runs as a non-root user, and the storage paths from tempo.yaml have
# to exist and be writable before Tempo starts
USER root
RUN mkdir -p /var/tempo/wal /var/tempo/blocks && chown -R 10001:10001 /var/tempo
USER 10001:10001
ENTRYPOINT ["/tempo"]
CMD ["-config.file=/etc/tempo.yaml"]

# build trigger
