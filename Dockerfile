FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN corepack enable && pnpm install --prod --no-frozen-lockfile

COPY server.mjs ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
