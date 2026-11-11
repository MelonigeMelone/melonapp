# syntax=docker/dockerfile:1
FROM rust:1-bookworm AS wasm
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY scripts scripts
ENV CARGO_INSTALL_ROOT=/tools PATH=/tools/bin:$PATH
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    --mount=type=cache,target=/tools \
    rustup target add wasm32-unknown-unknown && bash scripts/build-wasm.sh

FROM node:22-bookworm AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY docs/package.json docs/
COPY packages/melon-wasm/package.json packages/melon-wasm/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci -w web --no-audit --no-fund
COPY apps/web apps/web
COPY --from=wasm /src/packages/melon-wasm/pkg packages/melon-wasm/pkg
RUN npm run build -w web

FROM caddy:2-alpine
COPY --from=web /src/apps/web/dist /srv
