# Builds the Linear bridge and runs it as a standalone service.
#
# @Clawd runs this codebase as an OpenClaw plugin; the @Hermes deployment runs
# this image directly (BACKEND=hermes), with no OpenClaw to host it. The package
# has no runtime dependencies — only Node built-ins and global fetch — so the
# runtime stage ships just the compiled dist/.

# Use Debian-based Node images for predictable npm behavior across CI builders.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN node --version && npm --version && npm ci --no-audit --no-fund
COPY index.ts server.ts ./
COPY src ./src
RUN npm run build && find dist -name '*.test.js' -delete

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json LICENSE ./
COPY --from=build --chown=node:node /app/dist ./dist
# Railway injects PORT; the server defaults to 8080 when unset.
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
