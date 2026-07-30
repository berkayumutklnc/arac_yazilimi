# syntax=docker/dockerfile:1
#
# Build context KÖK dizin olmalı (docker-compose.prod.yml: build.context: .) —
# @arac-yazilim/shared workspace bağımlılığı ham TS kaynağı olarak tüketiliyor
# (next.config.ts transpilePackages, bkz. docs/adr/0015).

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# bkz. apps/api/Dockerfile'daki aynı not — diagServiceTypes.ts gitignored,
# apps/web'in @arac-yazilim/shared importu buna transitively bağımlı.
RUN npm run generate:diag-types -w @arac-yazilim/shared
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts: output "standalone" + outputFileTracingRoot repo köküne
# sabit — çıktı HER ZAMAN /repo/apps/web/.next/standalone altında, host'tan
# bağımsız (bkz. next.config.ts'teki gerekçe notu).
RUN npm run build -w @arac-yazilim/web

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# standalone çıktısı yalnızca server.js çalışması için gereken budanmış
# node_modules'ü taşır — .next/static ve public/ standalone'a BİLİNÇLİ OLARAK
# dahil değildir (Next.js'in kendi tasarımı), elle kopyalanmalı.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
