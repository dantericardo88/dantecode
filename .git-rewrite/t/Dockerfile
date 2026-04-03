# ============================================================================
# DanteCode Production Dockerfile
# Multi-stage build for optimized production image
# ============================================================================

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig*.json ./

# Copy workspace package files
COPY packages/*/package.json packages/*/
COPY packages/*/tsconfig.json packages/*/

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source code
COPY packages/ packages/
COPY scripts/ scripts/
COPY vitest.config.ts ./

# Build all packages
RUN npm run build

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    git \
    docker-cli \
    ca-certificates \
    tini

# Create non-root user
RUN addgroup -g 1001 dantecode && \
    adduser -D -u 1001 -G dantecode dantecode

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder --chown=dantecode:dantecode /app/packages/cli/dist/ /app/packages/cli/dist/
COPY --from=builder --chown=dantecode:dantecode /app/packages/core/dist/ /app/packages/core/dist/
COPY --from=builder --chown=dantecode:dantecode /app/packages/*/dist/ /app/packages/*/dist/
COPY --from=builder --chown=dantecode:dantecode /app/node_modules/ /app/node_modules/
COPY --from=builder --chown=dantecode:dantecode /app/packages/*/node_modules/ /app/packages/*/node_modules/

# Copy package files for runtime
COPY --chown=dantecode:dantecode package*.json ./
COPY --chown=dantecode:dantecode packages/*/package.json /app/packages/*/

# Create directories
RUN mkdir -p /app/.dantecode /app/data && \
    chown -R dantecode:dantecode /app/.dantecode /app/data

# Switch to non-root user
USER dantecode

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Expose API port
EXPOSE 3000

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default command: start server
CMD ["node", "packages/cli/dist/index.js", "serve", "--port", "3000"]
