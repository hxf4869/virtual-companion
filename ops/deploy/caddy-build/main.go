// Command caddy is the edge build of Caddy for ops/deploy/Dockerfile.web:
// upstream v2.11.7 with the official standard module set and embedded tzdata,
// rebuilt from source so the pinned Go toolchain and golang.org/x/net apply.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	// plug in Caddy modules here
	_ "github.com/caddyserver/caddy/v2/modules/standard"
	_ "time/tzdata"
)

func main() {
	caddycmd.Main()
}
