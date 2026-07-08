FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci
RUN npx playwright install chromium --with-deps

COPY backend/package*.json ./backend/
COPY backend/prisma ./backend/prisma/
RUN npm --prefix backend ci

COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend ci

COPY backend/ ./backend/
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

COPY playwright.config.ts tsconfig.json ./

RUN mkdir -p data/actionTest data/versioned/tests data/test-results screenshots

EXPOSE 3333

CMD ["npm", "--prefix", "backend", "run", "start"]
