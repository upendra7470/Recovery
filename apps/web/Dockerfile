FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace=@recoveryos/web

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY apps/web ./apps/web
COPY tsconfig.base.json ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build --workspace=@recoveryos/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./.next/static
COPY --from=build /app/apps/web/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
