# Multi-stage, standalone output (next.config.ts) — runtime image carries only traced deps.

FROM node:20-alpine AS deps
WORKDIR /app
# re2 (src/lib/safe-regex.ts) ships prebuilt binaries for common platforms but falls back to
# compiling from source (node-gyp) when none matches this image's musl libc — alpine's base
# image has no C++ toolchain by default, so npm ci would fail on that fallback path without this.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
