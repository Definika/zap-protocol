# ZAP engine: oracle stream, keeper, relayer, faucet, indexer and API in one Node service.
# Build from the repository root: docker build -f services/engine/Dockerfile .
FROM node:22-slim
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY services/engine/package.json services/engine/
COPY app/package.json app/
RUN npm ci -w packages/sdk -w services/engine --include-workspace-root --no-audit --no-fund
COPY config config
COPY packages/sdk packages/sdk
COPY services/engine services/engine
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "run", "start", "-w", "services/engine"]
