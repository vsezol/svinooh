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
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3000}"]
