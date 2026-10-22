FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY web ./web
RUN npm run build
RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8787
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "dist/src/server.js"]
