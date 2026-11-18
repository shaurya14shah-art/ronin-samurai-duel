# RŌNIN: one container serves the game (built client) and the authoritative duel server.
#   docker build -t ronin .
#   docker run -p 8080:8080 -v ronin-data:/app/server/data ronin
# Put it behind HTTPS (the client then connects with wss:// to the same origin).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/client/package.json client/
COPY --from=build /app/server/package.json server/
RUN npm ci --omit=dev --ignore-scripts --workspace=server
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
WORKDIR /app/server
# Accounts and records live here; mount a volume so they survive redeploys.
VOLUME /app/server/data
EXPOSE 8080
USER node
CMD ["node", "dist/server/src/index.js"]
