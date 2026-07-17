#!/bin/sh
set -e

# Runs as root, after docker-compose's volumes are mounted — data/, .env,
# src/, backend/ are host bind-mounts in the dev compose file, so their real
# permissions don't exist until now (a RUN step in the Dockerfile would only
# ever see the empty directories created at build time, not the mounted
# content). Lock everything under data/ and the app's own .env down to
# owner-only by default, then explicitly re-open just what an executing test
# spec needs for the restricted e2erunner account.
chmod 600 /app/.env 2>/dev/null || true
chmod -R go-rwx /app/data 2>/dev/null || true

# Reaching data/versioned/tests or data/screenshots at all requires execute
# ("traverse") permission on every ancestor directory, not just the target
# itself — go-rwx above just stripped it from data/ and data/versioned/ too.
# Grant e2erunner execute-only (no read, so it still can't list what's
# inside data/ or data/versioned/ directly) on just those two ancestors.
chgrp e2erunner /app/data /app/data/versioned 2>/dev/null || true
chmod g+x /app/data /app/data/versioned 2>/dev/null || true

chgrp -R e2erunner /app/data/versioned/tests /app/node_modules /app/src 2>/dev/null || true
chmod -R g+rX /app/data/versioned/tests /app/node_modules /app/src 2>/dev/null || true
chmod g+s /app/data/versioned/tests 2>/dev/null || true

chgrp e2erunner /app/playwright.config.ts /app/tsconfig.json 2>/dev/null || true
chmod g+r /app/playwright.config.ts /app/tsconfig.json 2>/dev/null || true

mkdir -p /app/data/screenshots
chown -R e2erunner:e2erunner /app/data/screenshots 2>/dev/null || true
chmod -R u+rwX /app/data/screenshots 2>/dev/null || true

# Playwright's outputDir (playwright.config.ts) — the runner itself, running
# as e2erunner, writes traces/last-run info there.
mkdir -p /app/data/test-results
chown -R e2erunner:e2erunner /app/data/test-results 2>/dev/null || true
chmod -R u+rwX /app/data/test-results 2>/dev/null || true

exec "$@"
