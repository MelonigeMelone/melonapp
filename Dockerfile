# syntax=docker/dockerfile:1
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p melon-server \
    && cp target/release/melon-server /melon-server

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /melon-server /usr/local/bin/melon-server
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/usr/local/bin/melon-server"]
