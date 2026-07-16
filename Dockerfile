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
COPY src/ ./src/

RUN mkdir -p data/actionTest data/versioned/tests data/test-results data/screenshots data/environments data/corrections data/pending

# Dedicated, unprivileged account for running test code (AI-authored or not)
# — never the backend's own root identity. --no-create-home + a nonexistent
# HOME means there's no writable .bashrc for a test to inject into, and a
# fixed uid/gid lets server.js/ia.js target it without a runtime lookup.
RUN groupadd --gid 10001 e2erunner \
	&& useradd --uid 10001 --gid 10001 --no-create-home --home /nonexistent --shell /usr/sbin/nologin e2erunner

ENV TEST_RUNNER_UID=10001
ENV TEST_RUNNER_GID=10001
ENV TEST_RUNNER_HOME=/nonexistent

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3333

# The permission lockdown itself lives in the entrypoint, not a RUN step —
# data/, .env, src/ etc. are host bind-mounts in docker-compose.yml, so
# their real permissions only exist once those volumes are attached, which
# happens after the image is built but before this runs.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "--prefix", "backend", "run", "start"]
