FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci
RUN npx playwright install chromium --with-deps

COPY app/ ./app/
COPY playwright.config.ts ./

RUN mkdir -p data/actionTest data/specs screenshots tests

EXPOSE 3333

CMD ["node", "app/server.js"]
