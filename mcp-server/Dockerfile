FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx esbuild src/index.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/index.cjs

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Runs as a non-root user. This service reads private journals; it should hold the
# narrowest identity it can.
USER node
EXPOSE 8080
CMD ["node", "dist/index.cjs"]
