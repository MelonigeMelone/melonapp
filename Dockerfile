# syntax=docker/dockerfile:1
FROM rust:1-trixie@sha256:0b0ea86881537b3f645aace7e8e39556289f8787db057317c8d4978548213b9e AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p melon-server \
    && cp target/release/melon-server /melon-server

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:532c7a94f9e96ba9db75eb9388f4227751131c7cb0a411d1a8521af4096135de
COPY --from=build /melon-server /usr/local/bin/melon-server
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/usr/local/bin/melon-server"]
