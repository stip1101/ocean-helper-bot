FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

FROM oven/bun:1-slim AS runtime
RUN apt-get update && apt-get install -y dumb-init curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN useradd -r -u 1001 appuser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

RUN mkdir -p src/knowledge && chown -R appuser:appuser src/knowledge

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "run", "src/index.ts"]
