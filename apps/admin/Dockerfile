# Build context is the monorepo ROOT (Railway: dockerfilePath is set in
# apps/admin/railway.json, leave Root Directory as "/").

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY apps/admin/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/admin/app app
# The tunables, from the same file the Node services read. Copied rather than
# duplicated: a knob declared once has to reach both stacks as the same bytes,
# or the admin ends up offering a bound the services do not enforce.
COPY libs/common/settings/registry.json ./registry.json

EXPOSE 3000
# --forwarded-allow-ips is what makes the panel render.
#
# Railway terminates TLS at its edge and forwards plain HTTP to the container,
# so uvicorn sees an http:// request and builds every absolute URL — including
# the stylesheet links SQLAdmin generates — with that scheme. A page served over
# https then asks for http:// assets, the browser refuses them, and the panel
# arrives as a column of blue links.
#
# X-Forwarded-Proto carries the truth, but uvicorn only believes it from
# 127.0.0.1 by default, and Railway's proxy is not localhost. "*" is the right
# answer here rather than a lax one: the container has no route to it except
# through that proxy.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3000} --proxy-headers --forwarded-allow-ips='*'"]
