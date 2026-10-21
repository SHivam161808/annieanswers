# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY config/schema ./config/schema
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config/clients ./config/clients
COPY knowledge/boilers ./knowledge/boilers
COPY ghl/sms-templates.yaml ./ghl/sms-templates.yaml
USER node
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
