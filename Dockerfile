FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Only install production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend and server
COPY --from=builder /app/dist ./dist
COPY server ./server

# Data directory — mounted as a Fly volume so SQLite survives restarts
RUN mkdir -p /data

EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production
ENV DB_PATH=/data/london-runs.db

CMD ["node", "server/index.js"]
