package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hxf4869/virtual-companion/internal/app"
	"github.com/hxf4869/virtual-companion/internal/blobstore"
	"github.com/hxf4869/virtual-companion/internal/bootstrap"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/jobs"
	"github.com/hxf4869/virtual-companion/internal/migrate"
	"github.com/hxf4869/virtual-companion/internal/observability"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/provider/openai"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func main() {
	if len(os.Args) == 2 {
		switch os.Args[1] {
		case "migrate":
			runMigrate()
			return
		case "bootstrap":
			runBootstrap()
			return
		}
	}
	os.Exit(run())
}

func runMigrate() {
	cfg, err := migrate.LoadEnv(os.Getenv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "companiond migrate: %v\n", err)
		os.Exit(1)
	}
	if err := migrate.Run(context.Background(), cfg); err != nil {
		fmt.Fprintf(os.Stderr, "companiond migrate: %v\n", err)
		os.Exit(1)
	}
	fmt.Fprintln(os.Stdout, "companiond migrate complete")
}

func runBootstrap() {
	cfg, err := bootstrap.LoadEnv(os.Getenv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "companiond bootstrap: %v\n", err)
		os.Exit(1)
	}
	if err := bootstrap.Run(context.Background(), cfg); err != nil {
		fmt.Fprintf(os.Stderr, "companiond bootstrap: %v\n", err)
		os.Exit(1)
	}
	fmt.Fprintln(os.Stdout, "companiond bootstrap complete")
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
	deps, err := wireDeps(cfg, log)
	if err != nil {
		log.Error("companiond wiring failed",
			slog.String("operation", "wire"),
			slog.String("outcome", "error"),
			slog.String("error_code", "WIRING_FAILED"),
		)
		return 1
	}
	rt, err := app.New(cfg, log, deps)
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
			slog.Any("error", err),
		)
		return 1
	}
	log.Info("companiond stopped",
		slog.String("operation", "stop"),
		slog.String("outcome", "ok"),
	)
	return 0
}

func wireDeps(cfg config.Config, log *slog.Logger) (app.Deps, error) {
	if cfg.Mode != config.ModeFull || cfg.Database.DSN == "" {
		return app.Deps{}, nil
	}
	cipher, err := postgres.NewFieldCipherWithPrevious(
		cfg.Crypto.RestKeyID,
		cfg.Crypto.RestKeyVersion,
		cfg.Crypto.RestKeyBase64,
		cfg.Crypto.PreviousRestKeyID,
		cfg.Crypto.PreviousRestKeyVersion,
		cfg.Crypto.PreviousRestKeyBase64,
	)
	if err != nil {
		return app.Deps{}, fmt.Errorf("rest cipher: %w", err)
	}
	checkCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	blobs, err := blobstore.New(checkCtx, blobstore.Config{
		Endpoint:  cfg.ExportS3.Endpoint,
		AccessKey: cfg.ExportS3.AccessKey,
		SecretKey: cfg.ExportS3.SecretKey,
		Bucket:    cfg.ExportS3.Bucket,
	}, cipher)
	if err != nil {
		return app.Deps{}, err
	}
	hub := realtime.New()
	loop := jobs.NewLoop(log, jobs.PolicyFrom(cfg), app.TurnBudget(cfg))
	loop.Use(nil, nil, hub, blobs)
	factory := modelprovider.Factory{
		ConnectTimeout:    cfg.Provider.ConnectTimeout,
		FirstTokenTimeout: cfg.Provider.FirstTokenTimeout,
		TotalTimeout:      cfg.Provider.TotalTimeout,
		MaxResponseBytes:  cfg.Provider.MaxResponseBytes,
		Temperature:       cfg.Provider.Temperature,
		AllowLoopbackHTTP: cfg.Provider.AllowLoopbackHTTP,
	}
	loop.UseProviderFactory(factory.Build)
	if cfg.Provider.Enabled {
		ad, err := openai.New(openai.Config{
			Endpoint:          cfg.Provider.Endpoint,
			BearerToken:       cfg.Provider.BearerToken,
			Model:             cfg.Provider.Model,
			MaxTokens:         cfg.Provider.MaxTokens,
			Temperature:       cfg.Provider.Temperature,
			ConnectTimeout:    cfg.Provider.ConnectTimeout,
			FirstTokenTimeout: cfg.Provider.FirstTokenTimeout,
			TotalTimeout:      cfg.Provider.TotalTimeout,
			MaxResponseBytes:  cfg.Provider.MaxResponseBytes,
			AllowLoopbackHTTP: cfg.Provider.AllowLoopbackHTTP,
		})
		if err != nil {
			return app.Deps{}, err
		}
		loop.Use(nil, ad, hub, blobs)
	}
	return app.Deps{
		Lease:            postgres.NewPlaneLease(cfg.Database.DSN),
		Jobs:             loop,
		Scheduler:        jobs.NewScheduler(loop),
		Provider:         jobs.ProviderPlane(),
		Realtime:         jobs.RealtimePlane(),
		GenerationWorker: jobs.GenerationWorkerPlane(),
		Cipher:           cipher,
		Blobs:            blobs,
	}, nil
}
