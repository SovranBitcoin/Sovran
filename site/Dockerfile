# Build from the repository root: docker build -f site/Dockerfile .
FROM oven/bun:1.3.5-alpine AS dependencies
WORKDIR /isolated
COPY site/package.json site/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM node:22.16.0-alpine AS build
ENV ASTRO_TELEMETRY_DISABLED=1
WORKDIR /build/site
COPY --from=dependencies /isolated/node_modules ./node_modules
COPY site/package.json site/bun.lock site/astro.config.mjs site/tsconfig.json ./
COPY site/src ./src
COPY site/public ./public
COPY site/scripts/verify-inputs.mjs ./scripts/verify-inputs.mjs
COPY site/scripts/local-releases.mjs ./scripts/local-releases.mjs
COPY site/scripts/local-artwork.mjs ./scripts/local-artwork.mjs
COPY site/scripts/visual.mjs ./scripts/visual.mjs
COPY site/scripts/variants.mjs ./scripts/variants.mjs
COPY scripts/site-brand.mjs /build/scripts/site-brand.mjs
COPY app/assets/brand/source/symbol.svg /build/app/assets/brand/source/symbol.svg
COPY scripts/lib/phone-frame.mjs /build/scripts/lib/phone-frame.mjs
COPY scripts/lib/app-source.mjs /build/scripts/lib/app-source.mjs
COPY copy/src/site.ts /build/copy/src/site.ts
COPY copy/legal/documents.json /build/copy/legal/documents.json
COPY press/artwork/source/screenshots.json /build/press/artwork/source/screenshots.json
COPY press/artwork/source/screenshot-context.json /build/press/artwork/source/screenshot-context.json
COPY press/artwork/source/screenshots/ios/*.png /build/press/artwork/source/screenshots/ios/
COPY press/artwork/source/screenshots/android/*.png /build/press/artwork/source/screenshots/android/
RUN node ../scripts/site-brand.mjs --check && node scripts/verify-inputs.mjs && node node_modules/astro/astro.js build

FROM nginx:1.28.0-alpine
ENV PORT=8080 ARTIFACT_ORIGIN="" ARTIFACT_RESOLVER=1.1.1.1
COPY --from=build /build/site/dist /usr/share/nginx/html
COPY site/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY site/nginx/15-site-env.sh /docker-entrypoint.d/15-site-env.sh
# Our narrow substitution preserves nginx's own variables; do not run it twice.
RUN chmod +x /docker-entrypoint.d/15-site-env.sh && rm /docker-entrypoint.d/20-envsubst-on-templates.sh
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
