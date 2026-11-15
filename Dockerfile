# Union Members (samithiya) - one image: Node API + built React frontend.
# Build context is the repository root:  docker compose build

# ---- 1. build the React frontend ----
FROM node:22-alpine AS web
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. install production dependencies of the API ----
FROM node:22-alpine AS deps
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- 3. runtime ----
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    SERVE_FRONTEND_DIR=/app/public
WORKDIR /app
COPY --from=deps /build/backend/node_modules ./node_modules
COPY backend/package.json backend/server.js ./
COPY backend/src ./src
COPY --from=web /build/frontend/dist ./public
# Run as the unprivileged "node" user (uid 1000); the app writes nothing to disk.
USER node
EXPOSE 3000
CMD ["node", "server.js"]
