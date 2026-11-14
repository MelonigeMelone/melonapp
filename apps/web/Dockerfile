# syntax=docker/dockerfile:1
FROM rust:1-bookworm@sha256:ade39a710ef85f3506cffcfec3e8a24ba090badef1dff2fb798f71d878833fea AS wasm
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY scripts scripts
ENV CARGO_INSTALL_ROOT=/tools PATH=/tools/bin:$PATH
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    --mount=type=cache,target=/tools \
    rustup target add wasm32-unknown-unknown && bash scripts/build-wasm.sh

FROM node:25-bookworm@sha256:78839ac448c23517f8eab2e8f7943d9b4f73979eb7f8bed2c73dbf72ff869e7b AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY docs/package.json docs/
COPY packages/melon-wasm/package.json packages/melon-wasm/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci -w web --no-audit --no-fund
COPY apps/web apps/web
COPY --from=wasm /src/packages/melon-wasm/pkg packages/melon-wasm/pkg
RUN npm run build -w web

FROM caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY --from=web /src/apps/web/dist /srv
