# syntax=docker/dockerfile:1
#
# Build context KÖK dizin olmalı (docker-compose.prod.yml: build.context: .) —
# npm workspaces tek bir kök package-lock.json'a göre çözülüyor, apps/api
# @arac-yazilim/shared'ı workspace bağımlılığı olarak kullanıyor (bkz.
# docs/adr/0015-production-deployment-architecture.md).

FROM node:22-alpine AS deps
WORKDIR /repo
# Tüm workspace package.json'ları gerekli — npm ci tek lockfile'ın TÜM
# workspace'lerle tutarlı olduğunu doğrular, yalnızca apps/api'yi kopyalamak
# yeterli değil.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# packages/shared "main": "src/index.ts" olarak ham TS kaynağı şeklinde
# tüketiliyor — src/generated/diagServiceTypes.ts commit'lenmemiş (gitignored),
# apps/api'nin types/index.ts'i buna TRANSITIVE olarak bağımlı (doğrulandı: bu
# adım atlanırsa sonraki tsc derlemesi TS2307 ile başarısız olur).
RUN npm run generate:diag-types -w @arac-yazilim/shared
# Prisma client kaynak (.ts) + native query engine (.node) üretir — ikincisi
# `tsc` tarafından dist/'e KOPYALANMAZ (yalnızca .ts derler), bu yüzden build
# sonrası elle taşınıyor (aşağıda).
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @arac-yazilim/api
RUN cp apps/api/src/generated/prisma/*.node apps/api/dist/generated/prisma/
# Yalnızca prod bağımlılıkları kalsın — devDependencies (tsx, eslint, vitest…)
# runtime imajına girmez. `prisma` (CLI) BİLİNÇLİ OLARAK dependencies'te (bkz.
# apps/api/package.json) — `migrate deploy` üretimde bu imajla çalıştırılıyor.
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /repo/apps/api
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/node_modules /repo/node_modules
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./package.json
# migrate deploy runtime'da migrations/ dosyalarına ihtiyaç duyar (schema.prisma
# değil — yalnızca migrations/ ve gerekiyorsa prisma.config.ts).
COPY --from=build --chown=app:app /repo/apps/api/prisma ./prisma
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
