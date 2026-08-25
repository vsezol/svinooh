# Контекст сборки — корень монорепы (railway.json задаёт dockerfilePath,
# Root Directory = «/»). Просто печём конфиг в официальный образ.
FROM prom/prometheus:v2.54.1
COPY ops/prometheus/prometheus.yml /etc/prometheus/prometheus.yml
