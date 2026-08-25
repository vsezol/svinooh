# Контекст сборки — КОРЕНЬ монорепы (Railway: dockerfilePath задан в
# apps/web/railway.json, Root Directory оставить «/»).
#
# VITE_API_URL зашивается в статику при сборке: на Railway достаточно
# завести переменную VITE_API_URL у сервиса web (публичный URL api),
# Railway прокинет её в docker build как ARG.

FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json nx.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY libs/shared/package.json libs/shared/
RUN npm ci -w apps/web --no-audit --no-fund

COPY libs/shared libs/shared
COPY apps/web apps/web
RUN npm run -w apps/web build

FROM node:22-alpine
RUN npm i -g serve@14
COPY --from=build /app/apps/web/dist /app/dist
ENV PORT=4173
EXPOSE 4173
# -s: SPA-фолбэк на index.html для маршрутов вида /p/:slug
CMD ["sh", "-c", "serve -s /app/dist -l tcp://0.0.0.0:${PORT}"]
