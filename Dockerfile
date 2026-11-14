# syntax=docker/dockerfile:1
FROM rust:1-trixie@sha256:0b0ea86881537b3f645aace7e8e39556289f8787db057317c8d4978548213b9e AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p melon-server \
    && cp target/release/melon-server /melon-server

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2
COPY --from=build /melon-server /usr/local/bin/melon-server
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/usr/local/bin/melon-server"]
