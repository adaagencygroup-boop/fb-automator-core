FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN sed -i '/"fb-automator-core"/d' package.json && npm install
FROM node:24-alpine AS dev
WORKDIR /app
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN sed -i '/"fb-automator-core"/d' package.json
ARG NEXT_PUBLIC_VPS_API_URL=https://adagroupservice.com
ENV NEXT_PUBLIC_VPS_API_URL=${NEXT_PUBLIC_VPS_API_URL}
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
RUN sed -i '/"fb-automator-core"/d' package.json
ARG NEXT_PUBLIC_VPS_API_URL=https://adagroupservice.com
ENV NEXT_PUBLIC_VPS_API_URL=${NEXT_PUBLIC_VPS_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
FROM node:24-alpine AS runner
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/adaagencygroup-boop/fb-automator-core"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
RUN chmod -R 755 /app
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]