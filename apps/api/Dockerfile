FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
RUN npm ci --workspace=@recoveryos/api

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api ./apps/api
COPY tsconfig.base.json ./
RUN npm run prisma:generate --workspace=@recoveryos/api
RUN npm run build --workspace=@recoveryos/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
