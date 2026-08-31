# Go-only application image. The same binary handles one-shot migration and
# bootstrap commands before starting the steady-state runtime.
FROM golang:1.26.7-alpine3.23@sha256:b17af760035fc2f338eed92d448a6c67f2d45438844fc6c60678fa5f99e44b57 AS build

WORKDIR /src
COPY go.mod go.sum ./
COPY vendor ./vendor
COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 go build -mod=vendor -trimpath -ldflags="-s -w" \
    -o /out/companiond ./cmd/companiond

FROM alpine:3.23.3@sha256:25109184c71bdad752c8312a8623239686a9a2071e8825f20acb8f2198c3f659

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/companiond /usr/local/bin/companiond

RUN addgroup -S vc && adduser -S -G vc vc
USER vc

EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --retries=30 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/actuator/health || exit 1

ENTRYPOINT ["/usr/local/bin/companiond"]
