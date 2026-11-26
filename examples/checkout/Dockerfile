FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS node
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN apt-get update && apt-get install --no-install-recommends -y postgresql-16 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN node /usr/local/lib/node_modules/npm/bin/npm-cli.js exec --yes --package=npm@12.2.1 -- npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY dist/packages ./dist/packages
COPY dist/examples ./dist/examples
ARG BAD_REVISION
ARG FIXED_REVISION
ARG RECIPE_REVISION
LABEL repro.recipe="checkout-v1" repro.playwright="1.65.1" repro.contract="${RECIPE_REVISION}" repro.source.bad="${BAD_REVISION}" repro.source.fixed="${FIXED_REVISION}"
USER 1001:1001
