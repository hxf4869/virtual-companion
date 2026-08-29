package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/hxf4869/virtual-companion/internal/app"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
)

func main() {
	os.Exit(run())
}

func run() int {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "companiond: config: %v\n", err)
		return 1
	}
	log := observability.NewLogger(cfg.Log.Level, os.Stdout)
	log.Info("companiond starting",
		slog.String("operation", "start"),
		slog.String("outcome", "ok"),
		slog.String("mode", string(cfg.Mode)),
	)
	rt, err := app.New(cfg, log, app.Deps{})
	if err != nil {
		log.Error("companiond wiring failed",
			slog.String("operation", "wire"),
			slog.String("outcome", "error"),
			slog.String("error_code", "WIRING_FAILED"),
		)
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := rt.Run(ctx); err != nil {
		log.Error("companiond exit",
			slog.String("operation", "run"),
			slog.String("outcome", "error"),
			slog.String("error_code", "RUN_FAILED"),
		)
		return 1
	}
	log.Info("companiond stopped",
		slog.String("operation", "stop"),
		slog.String("outcome", "ok"),
	)
	return 0
}
