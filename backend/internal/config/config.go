package config

import (
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

// Mode is the only migration-window runtime switch. It is not a feature-flag
// system; Phase 6 deletes both values together with the generation-plane lease.
type Mode string

const (
	ModeAPIMigration Mode = "api-migration"
	ModeFull         Mode = "full"
)

// Plane is a production capability that api-migration must never start
// (redesign §16.5). Names stay stable so isolation tests fail closed if a
// later slice forgets the gate.
type Plane string

const (
	PlaneProvider         Plane = "provider"
	PlaneJobs             Plane = "jobs"
	PlaneRealtime         Plane = "realtime"
	PlaneScheduler        Plane = "scheduler"
	PlaneGenerationWorker Plane = "generation-worker"
)

// ForbiddenPlanes is the complete api-migration denylist.
func ForbiddenPlanes() []Plane {
	return []Plane{
		PlaneProvider,
		PlaneJobs,
		PlaneRealtime,
		PlaneScheduler,
		PlaneGenerationWorker,
	}
}

// Config is the single explicit process configuration. Secrets, when later
// slices add them, come only from the environment or private files outside
// the repository.
type Config struct {
	Mode     Mode
	HTTP     HTTP
	Log      Log
	Pprof    Pprof
	Shutdown Shutdown
	Version  Version
}

type HTTP struct {
	Addr string
}

type Log struct {
	Level string
}

type Pprof struct {
	// Addr is empty when disabled. A set value must be loopback.
	Addr string
}

type Shutdown struct {
	Timeout time.Duration
}

type Version struct {
	Version string
	Commit  string
}

func (m Mode) AllowsWrites() bool {
	return m == ModeFull
}

func (c Config) AllowsWrites() bool {
	return c.Mode.AllowsWrites()
}

// Allows reports whether mode may start the named plane. api-migration is
// hard-false for every ForbiddenPlanes entry; there is no override flag.
func (c Config) Allows(p Plane) bool {
	if c.Mode != ModeFull {
		return false
	}
	switch p {
	case PlaneProvider, PlaneJobs, PlaneRealtime, PlaneScheduler, PlaneGenerationWorker:
		return true
	default:
		return false
	}
}

func Load() (Config, error) {
	return LoadEnv(os.Getenv)
}

func LoadEnv(getenv func(string) string) (Config, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	cfg := Config{
		Mode:  Mode(strings.TrimSpace(getenv("VC_MODE"))),
		HTTP:  HTTP{Addr: valueOr(strings.TrimSpace(getenv("VC_HTTP_ADDR")), "127.0.0.1:8080")},
		Log:   Log{Level: valueOr(strings.ToLower(strings.TrimSpace(getenv("VC_LOG_LEVEL"))), "info")},
		Pprof: Pprof{Addr: strings.TrimSpace(getenv("VC_PPROF_ADDR"))},
		Shutdown: Shutdown{
			Timeout: 15 * time.Second,
		},
		Version: Version{
			Version: valueOr(strings.TrimSpace(getenv("VC_VERSION")), "0.1.0-dev"),
			Commit:  strings.TrimSpace(getenv("VC_COMMIT")),
		},
	}
	if raw := strings.TrimSpace(getenv("VC_SHUTDOWN_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_SHUTDOWN_TIMEOUT: %w", err)
		}
		cfg.Shutdown.Timeout = d
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	switch c.Mode {
	case ModeAPIMigration, ModeFull:
	case "":
		return fmt.Errorf("VC_MODE is required (api-migration or full)")
	default:
		return fmt.Errorf("VC_MODE must be api-migration or full, got %q", c.Mode)
	}
	if strings.TrimSpace(c.HTTP.Addr) == "" {
		return fmt.Errorf("VC_HTTP_ADDR is required")
	}
	switch c.Log.Level {
	case "debug", "info", "warn", "error":
	default:
		return fmt.Errorf("VC_LOG_LEVEL must be debug, info, warn, or error")
	}
	if c.Shutdown.Timeout <= 0 {
		return fmt.Errorf("VC_SHUTDOWN_TIMEOUT must be > 0")
	}
	if c.Pprof.Addr != "" {
		host, _, err := net.SplitHostPort(c.Pprof.Addr)
		if err != nil {
			return fmt.Errorf("VC_PPROF_ADDR: %w", err)
		}
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return fmt.Errorf("VC_PPROF_ADDR must bind loopback, got %q", c.Pprof.Addr)
		}
	}
	if strings.TrimSpace(c.Version.Version) == "" {
		return fmt.Errorf("VC_VERSION must not be empty")
	}
	return nil
}

func valueOr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
