FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
FROM node:24-alpine AS dev
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_URL=https://admin.adagroupservice.com
ENV NEXT_PUBLIC_URL=${NEXT_PUBLIC_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000", "--webpack"]
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_URL=https://admin.adagroupservice.com
ENV NEXT_PUBLIC_URL=${NEXT_PUBLIC_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,target=/app/.next/cache npm run build
FROM node:24-alpine AS runner
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/adaagencygroup-boop/fb-automator-core"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]