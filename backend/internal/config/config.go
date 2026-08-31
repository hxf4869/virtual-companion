package config

import (
	"encoding/base64"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
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

// Config is the single explicit process configuration. Secrets come only
// from the environment or private files outside the repository and are
// never logged.
type Config struct {
	Mode         Mode
	HTTP         HTTP
	Log          Log
	Pprof        Pprof
	Shutdown     Shutdown
	Version      Version
	Database     Database
	OwnerBinding OwnerBinding
	Crypto       Crypto
	ExportS3     ExportS3
	Provider     Provider
	Budget       Budget
	Session      Session
	Concurrency  Concurrency
}

// ExportS3 is the one supported export object store. Runtime access is
// deliberately narrower than a general S3 configuration surface.
type ExportS3 struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
}

// Concurrency is runtime admission, not a per-turn budget (§10.6).
type Concurrency struct {
	MaxOutstandingTurns int
	MaxConcurrentTurns  int
	QueueTimeout        time.Duration
	ClaimLimit          int
	RecoverInterval     time.Duration
}

// Session is the Go v1 opaque cookie lifetime. Actual production cutover
// stays Phase 5; these defaults serve isolation/full-mode dogfood.
type Session struct {
	TTL          time.Duration
	CookieSecure bool
	ReauthWindow time.Duration
}

// Provider is the migration bootstrap OpenAI-compatible route plus shared
// provider HTTP budgets. Database-managed routes take precedence; Enabled=false
// leaves only the administrator route chain. Secrets never log.
type Provider struct {
	ID                string
	SupplierName      string
	Enabled           bool
	Endpoint          string
	BearerToken       string
	Model             string
	MaxTokens         int
	Temperature       float64
	ConnectTimeout    time.Duration
	FirstTokenTimeout time.Duration
	TotalTimeout      time.Duration
	MaxResponseBytes  int64
	// AllowLoopbackHTTP permits http://127.0.0.1 provider endpoints for the
	// G11 switchover drill / G12 capacity measurement fake provider and the
	// §19.1 local model provider (Ollama) on the Owner dogfood stack. Default
	// false keeps the fail-closed production posture (provider never uses
	// plaintext loopback unless explicitly configured).
	AllowLoopbackHTTP bool
}

// Budget is the per-turn freeze applied at intake/prepare (redesign §10.6).
// Admission/concurrency limits do not belong here. Illegal values fail startup.
type Budget struct {
	MaxInputTokens    int
	MaxOutputTokens   int
	MaxResponseBytes  int64
	ConnectTimeout    time.Duration
	FirstTokenTimeout time.Duration
	TotalTimeout      time.Duration
	MaxAttempts       int
	MaxReservedCost   int64
}

// Database is the pgx pool. Empty DSN means companiond starts without a
// pool (G2 tests and processes that do not touch PostgreSQL).
type Database struct {
	DSN       string
	MaxConns  int32
	TxTimeout time.Duration
}

// OwnerBinding is the V27 HMAC key material. Required when Database.DSN is set.
type OwnerBinding struct {
	Secret string
}

// Crypto is the at-rest field cipher. Go only writes enc2; enc1/plaintext
// are dual-read until Phase 6 deletes the legacy reader.
type Crypto struct {
	RestKeyID              string
	RestKeyVersion         int
	RestKeyBase64          string
	PreviousRestKeyID      string
	PreviousRestKeyVersion int
	PreviousRestKeyBase64  string
}

type HTTP struct {
	Addr              string
	AllowedOrigins    []string
	TrustProxyHeaders bool
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
	origins, err := parseHTTPOrigins(getenv("VC_HTTP_ORIGINS"))
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Mode: Mode(strings.TrimSpace(getenv("VC_MODE"))),
		HTTP: HTTP{
			Addr:              valueOr(strings.TrimSpace(getenv("VC_HTTP_ADDR")), "127.0.0.1:8080"),
			AllowedOrigins:    origins,
			TrustProxyHeaders: false,
		},
		Log:   Log{Level: valueOr(strings.ToLower(strings.TrimSpace(getenv("VC_LOG_LEVEL"))), "info")},
		Pprof: Pprof{Addr: strings.TrimSpace(getenv("VC_PPROF_ADDR"))},
		Shutdown: Shutdown{
			Timeout: 15 * time.Second,
		},
		Version: Version{
			Version: valueOr(strings.TrimSpace(getenv("VC_VERSION")), "0.1.0-dev"),
			Commit:  strings.TrimSpace(getenv("VC_COMMIT")),
		},
		Database: Database{
			DSN:       strings.TrimSpace(getenv("VC_DB_DSN")),
			MaxConns:  8,
			TxTimeout: 5 * time.Second,
		},
		OwnerBinding: OwnerBinding{Secret: getenv("VC_OWNER_BINDING_SECRET")},
		Crypto: Crypto{
			RestKeyID:              valueOr(strings.TrimSpace(getenv("VC_CRYPTO_REST_KEY_ID")), "default"),
			RestKeyVersion:         1,
			RestKeyBase64:          strings.TrimSpace(getenv("VC_CRYPTO_REST_KEY")),
			PreviousRestKeyID:      strings.TrimSpace(getenv("VC_CRYPTO_PREVIOUS_REST_KEY_ID")),
			PreviousRestKeyVersion: 0,
			PreviousRestKeyBase64:  strings.TrimSpace(getenv("VC_CRYPTO_PREVIOUS_REST_KEY")),
		},
		ExportS3: ExportS3{
			Endpoint:  strings.TrimSpace(getenv("VC_EXPORT_S3_ENDPOINT")),
			AccessKey: strings.TrimSpace(getenv("VC_EXPORT_S3_ACCESS_KEY")),
			SecretKey: getenv("VC_EXPORT_S3_SECRET_KEY"),
			Bucket:    strings.TrimSpace(getenv("VC_EXPORT_S3_BUCKET")),
		},
		Provider: Provider{
			ID:                valueOr(strings.TrimSpace(getenv("VC_PROVIDER_ID")), "openai-compatible"),
			SupplierName:      valueOr(strings.TrimSpace(getenv("VC_PROVIDER_SUPPLIER_NAME")), "openai-compatible"),
			Enabled:           strings.EqualFold(strings.TrimSpace(getenv("VC_PROVIDER_ENABLED")), "true"),
			Endpoint:          strings.TrimSpace(getenv("VC_PROVIDER_ENDPOINT")),
			BearerToken:       getenv("VC_PROVIDER_TOKEN"),
			Model:             strings.TrimSpace(getenv("VC_PROVIDER_MODEL")),
			MaxTokens:         8192,
			Temperature:       1.0,
			ConnectTimeout:    10 * time.Second,
			FirstTokenTimeout: 60 * time.Second,
			TotalTimeout:      240 * time.Second,
			MaxResponseBytes:  256 << 10,
			AllowLoopbackHTTP: strings.EqualFold(strings.TrimSpace(getenv("VC_PROVIDER_ALLOW_LOOPBACK_HTTP")), "true"),
		},
		Budget: Budget{
			MaxInputTokens:    8000,
			MaxOutputTokens:   2048,
			MaxResponseBytes:  256 << 10,
			ConnectTimeout:    10 * time.Second,
			FirstTokenTimeout: 60 * time.Second,
			TotalTimeout:      240 * time.Second,
			MaxAttempts:       2,
			MaxReservedCost:   0,
		},
		Session: Session{
			TTL:          7 * 24 * time.Hour,
			CookieSecure: true,
			ReauthWindow: 15 * time.Minute,
		},
		Concurrency: Concurrency{
			// §19.5 Owner-only product defaults: serial worker, 8 outstanding,
			// 5-minute queue timeout. Benchmark profiles override per run and
			// must be restored afterwards.
			MaxOutstandingTurns: 8,
			MaxConcurrentTurns:  1,
			QueueTimeout:        5 * time.Minute,
			ClaimLimit:          8,
			RecoverInterval:     5 * time.Second,
		},
	}
	if raw := strings.TrimSpace(getenv("VC_HTTP_TRUST_PROXY_HEADERS")); raw != "" {
		switch strings.ToLower(raw) {
		case "true", "1":
			cfg.HTTP.TrustProxyHeaders = true
		case "false", "0":
			cfg.HTTP.TrustProxyHeaders = false
		default:
			return Config{}, fmt.Errorf("VC_HTTP_TRUST_PROXY_HEADERS must be true or false")
		}
	}
	if raw := strings.TrimSpace(getenv("VC_SHUTDOWN_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_SHUTDOWN_TIMEOUT: %w", err)
		}
		cfg.Shutdown.Timeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_DB_MAX_CONNS")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 32)
		if err != nil {
			return Config{}, fmt.Errorf("VC_DB_MAX_CONNS: %w", err)
		}
		cfg.Database.MaxConns = int32(n)
	}
	if raw := strings.TrimSpace(getenv("VC_DB_TX_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_DB_TX_TIMEOUT: %w", err)
		}
		cfg.Database.TxTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_CRYPTO_REST_KEY_VERSION")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_CRYPTO_REST_KEY_VERSION: %w", err)
		}
		cfg.Crypto.RestKeyVersion = n
	}
	if raw := strings.TrimSpace(getenv("VC_CRYPTO_PREVIOUS_REST_KEY_VERSION")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_CRYPTO_PREVIOUS_REST_KEY_VERSION: %w", err)
		}
		cfg.Crypto.PreviousRestKeyVersion = n
	}
	if raw := strings.TrimSpace(getenv("VC_PROVIDER_MAX_TOKENS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_PROVIDER_MAX_TOKENS: %w", err)
		}
		cfg.Provider.MaxTokens = n
	}
	if raw := strings.TrimSpace(getenv("VC_PROVIDER_TEMPERATURE")); raw != "" {
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return Config{}, fmt.Errorf("VC_PROVIDER_TEMPERATURE: %w", err)
		}
		cfg.Provider.Temperature = f
	}
	if raw := strings.TrimSpace(getenv("VC_PROVIDER_CONNECT_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_PROVIDER_CONNECT_TIMEOUT: %w", err)
		}
		cfg.Provider.ConnectTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_PROVIDER_FIRST_TOKEN_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_PROVIDER_FIRST_TOKEN_TIMEOUT: %w", err)
		}
		cfg.Provider.FirstTokenTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_PROVIDER_TOTAL_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("VC_PROVIDER_TOTAL_TIMEOUT: %w", err)
		}
		cfg.Provider.TotalTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_PROVIDER_MAX_RESPONSE_BYTES")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return Config{}, fmt.Errorf("VC_PROVIDER_MAX_RESPONSE_BYTES: %w", err)
		}
		cfg.Provider.MaxResponseBytes = n
	}
	if err := loadBudgetEnv(&cfg, getenv); err != nil {
		return Config{}, err
	}
	if err := loadSessionEnv(&cfg, getenv); err != nil {
		return Config{}, err
	}
	if err := loadConcurrencyEnv(&cfg, getenv); err != nil {
		return Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func loadSessionEnv(cfg *Config, getenv func(string) string) error {
	if raw := strings.TrimSpace(getenv("VC_SESSION_TTL")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("VC_SESSION_TTL: %w", err)
		}
		cfg.Session.TTL = d
	}
	if raw := strings.TrimSpace(getenv("VC_SESSION_COOKIE_SECURE")); raw != "" {
		switch strings.ToLower(raw) {
		case "true", "1":
			cfg.Session.CookieSecure = true
		case "false", "0":
			cfg.Session.CookieSecure = false
		default:
			return fmt.Errorf("VC_SESSION_COOKIE_SECURE must be true or false")
		}
	}
	if raw := strings.TrimSpace(getenv("VC_SESSION_REAUTH_WINDOW")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("VC_SESSION_REAUTH_WINDOW: %w", err)
		}
		cfg.Session.ReauthWindow = d
	}
	return nil
}

func loadConcurrencyEnv(cfg *Config, getenv func(string) string) error {
	if raw := strings.TrimSpace(getenv("VC_MAX_OUTSTANDING_TURNS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("VC_MAX_OUTSTANDING_TURNS: %w", err)
		}
		cfg.Concurrency.MaxOutstandingTurns = n
	}
	if raw := strings.TrimSpace(getenv("VC_MAX_CONCURRENT_TURNS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("VC_MAX_CONCURRENT_TURNS: %w", err)
		}
		cfg.Concurrency.MaxConcurrentTurns = n
	}
	if raw := strings.TrimSpace(getenv("VC_QUEUE_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("VC_QUEUE_TIMEOUT: %w", err)
		}
		cfg.Concurrency.QueueTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_JOB_CLAIM_LIMIT")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("VC_JOB_CLAIM_LIMIT: %w", err)
		}
		cfg.Concurrency.ClaimLimit = n
	}
	if raw := strings.TrimSpace(getenv("VC_JOB_RECOVER_INTERVAL")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("VC_JOB_RECOVER_INTERVAL: %w", err)
		}
		cfg.Concurrency.RecoverInterval = d
	}
	return nil
}

func loadBudgetEnv(cfg *Config, getenv func(string) string) error {
	if raw := strings.TrimSpace(getenv("VC_BUDGET_MAX_INPUT_TOKENS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_MAX_INPUT_TOKENS: %w", err)
		}
		cfg.Budget.MaxInputTokens = n
	}
	if raw := strings.TrimSpace(getenv("VC_BUDGET_MAX_OUTPUT_TOKENS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_MAX_OUTPUT_TOKENS: %w", err)
		}
		cfg.Budget.MaxOutputTokens = n
	}
	if raw := strings.TrimSpace(getenv("VC_BUDGET_MAX_RESPONSE_BYTES")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_MAX_RESPONSE_BYTES: %w", err)
		}
		cfg.Budget.MaxResponseBytes = n
	}
	if raw := strings.TrimSpace(getenv("VC_BUDGET_CONNECT_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_CONNECT_TIMEOUT: %w", err)
		}
		cfg.Budget.ConnectTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_BUDGET_FIRST_TOKEN_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_FIRST_TOKEN_TIMEOUT: %w", err)
		}
		cfg.Budget.FirstTokenTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_BUDGET_TOTAL_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_TOTAL_TIMEOUT: %w", err)
		}
		cfg.Budget.TotalTimeout = d
	}
	if raw := strings.TrimSpace(getenv("VC_BUDGET_MAX_ATTEMPTS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_MAX_ATTEMPTS: %w", err)
		}
		cfg.Budget.MaxAttempts = n
	}
	if raw := strings.TrimSpace(getenv("VC_BUDGET_MAX_RESERVED_COST")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return fmt.Errorf("VC_BUDGET_MAX_RESERVED_COST: %w", err)
		}
		cfg.Budget.MaxReservedCost = n
	}
	return nil
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
	if err := validateOrigins(c.HTTP.AllowedOrigins); err != nil {
		return err
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
	if c.Database.DSN != "" {
		if c.Database.MaxConns <= 0 {
			return fmt.Errorf("VC_DB_MAX_CONNS must be > 0")
		}
		if c.Database.TxTimeout <= 0 {
			return fmt.Errorf("VC_DB_TX_TIMEOUT must be > 0")
		}
		if len(c.OwnerBinding.Secret) < 32 {
			return fmt.Errorf("VC_OWNER_BINDING_SECRET must carry at least 32 bytes of key material when VC_DB_DSN is set")
		}
	}
	if c.Mode == ModeFull && c.Database.DSN != "" {
		if strings.TrimSpace(c.Crypto.RestKeyBase64) == "" {
			return fmt.Errorf("VC_CRYPTO_REST_KEY is required when VC_MODE=full and VC_DB_DSN is set")
		}
		if c.Crypto.RestKeyVersion <= 0 {
			return fmt.Errorf("VC_CRYPTO_REST_KEY_VERSION must be a positive integer")
		}
		if err := c.ExportS3.validate(); err != nil {
			return err
		}
	}
	if c.Crypto.RestKeyBase64 != "" {
		if err := requireAESKey(c.Crypto.RestKeyBase64); err != nil {
			return fmt.Errorf("VC_CRYPTO_REST_KEY: %w", err)
		}
		if c.Crypto.RestKeyVersion <= 0 {
			return fmt.Errorf("VC_CRYPTO_REST_KEY_VERSION must be a positive integer")
		}
	}
	if c.Crypto.PreviousRestKeyBase64 != "" {
		if err := requireAESKey(c.Crypto.PreviousRestKeyBase64); err != nil {
			return fmt.Errorf("VC_CRYPTO_PREVIOUS_REST_KEY: %w", err)
		}
	}
	if c.Provider.Enabled {
		if len(c.Provider.ID) < 1 || len(c.Provider.ID) > 128 {
			return fmt.Errorf("VC_PROVIDER_ID must be 1..128 characters")
		}
		if len(c.Provider.SupplierName) < 1 || len(c.Provider.SupplierName) > 128 {
			return fmt.Errorf("VC_PROVIDER_SUPPLIER_NAME must be 1..128 characters")
		}
		if strings.TrimSpace(c.Provider.Endpoint) == "" {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT is required when VC_PROVIDER_ENABLED=true")
		}
		if strings.TrimSpace(c.Provider.BearerToken) == "" {
			return fmt.Errorf("VC_PROVIDER_TOKEN is required when VC_PROVIDER_ENABLED=true")
		}
		if strings.TrimSpace(c.Provider.Model) == "" {
			return fmt.Errorf("VC_PROVIDER_MODEL is required when VC_PROVIDER_ENABLED=true")
		}
		if c.Provider.MaxTokens < 1 || c.Provider.MaxTokens > 8192 {
			return fmt.Errorf("VC_PROVIDER_MAX_TOKENS must be between 1 and 8192")
		}
		if c.Provider.Temperature < 0 || c.Provider.Temperature > 2 {
			return fmt.Errorf("VC_PROVIDER_TEMPERATURE must be between 0 and 2")
		}
		if c.Provider.ConnectTimeout <= 0 {
			return fmt.Errorf("VC_PROVIDER_CONNECT_TIMEOUT must be > 0")
		}
		if c.Provider.FirstTokenTimeout <= 0 {
			return fmt.Errorf("VC_PROVIDER_FIRST_TOKEN_TIMEOUT must be > 0")
		}
		if c.Provider.TotalTimeout <= 0 {
			return fmt.Errorf("VC_PROVIDER_TOTAL_TIMEOUT must be > 0")
		}
		if c.Provider.MaxResponseBytes <= 0 || c.Provider.MaxResponseBytes > 1<<20 {
			return fmt.Errorf("VC_PROVIDER_MAX_RESPONSE_BYTES must be in (0, 1048576]")
		}
		u, err := url.Parse(c.Provider.Endpoint)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT must be an absolute URL")
		}
		if !strings.EqualFold(u.Scheme, "https") &&
			!(c.Provider.AllowLoopbackHTTP && strings.EqualFold(u.Scheme, "http") && isLoopbackHost(u.Hostname())) {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT must use https")
		}
		if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT must not include user info, query, or fragment")
		}
		if !strings.HasSuffix(u.EscapedPath(), "/v1/chat/completions") {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT path must end with /v1/chat/completions")
		}
	}
	if c.Session.TTL < time.Hour || c.Session.TTL > 30*24*time.Hour {
		return fmt.Errorf("VC_SESSION_TTL must be between 1h and 720h")
	}
	if c.Session.ReauthWindow < time.Minute || c.Session.ReauthWindow > time.Hour {
		return fmt.Errorf("VC_SESSION_REAUTH_WINDOW must be between 1m and 1h")
	}
	if c.Concurrency.MaxOutstandingTurns < 1 || c.Concurrency.MaxOutstandingTurns > 16 {
		return fmt.Errorf("VC_MAX_OUTSTANDING_TURNS must be in [1, 16]")
	}
	if c.Concurrency.MaxConcurrentTurns < 1 || c.Concurrency.MaxConcurrentTurns > 16 {
		return fmt.Errorf("VC_MAX_CONCURRENT_TURNS must be in [1, 16]")
	}
	if c.Concurrency.QueueTimeout < 5*time.Second || c.Concurrency.QueueTimeout > 30*time.Minute {
		return fmt.Errorf("VC_QUEUE_TIMEOUT must be between 5s and 30m")
	}
	if c.Concurrency.ClaimLimit < 1 || c.Concurrency.ClaimLimit > 32 {
		return fmt.Errorf("VC_JOB_CLAIM_LIMIT must be in [1, 32]")
	}
	if c.Concurrency.RecoverInterval < time.Second || c.Concurrency.RecoverInterval > time.Minute {
		return fmt.Errorf("VC_JOB_RECOVER_INTERVAL must be between 1s and 1m")
	}
	return c.Budget.validate(c.Provider)
}

func (s ExportS3) validate() error {
	required := []struct {
		name  string
		value string
	}{
		{"VC_EXPORT_S3_ENDPOINT", s.Endpoint},
		{"VC_EXPORT_S3_ACCESS_KEY", s.AccessKey},
		{"VC_EXPORT_S3_SECRET_KEY", s.SecretKey},
		{"VC_EXPORT_S3_BUCKET", s.Bucket},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required when VC_MODE=full and VC_DB_DSN is set", item.name)
		}
	}
	u, err := url.Parse(s.Endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("VC_EXPORT_S3_ENDPOINT must be an absolute http(s) URL")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return fmt.Errorf("VC_EXPORT_S3_ENDPOINT must not include user info, path, query, or fragment")
	}
	return nil
}

const (
	hardMaxInputTokens      = 32000
	hardMaxOutputTokens     = 8192
	hardMaxBudgetResponse   = 1 << 20
	hardMaxBudgetConnect    = 60 * time.Second
	hardMaxBudgetFirstToken = 5 * time.Minute
	hardMaxBudgetTotal      = 10 * time.Minute
	hardMaxAttempts         = 2
	hardMaxReservedCost     = 1_000_000_000_000
)

func (b Budget) validate(p Provider) error {
	if b.MaxInputTokens < 1 || b.MaxInputTokens > hardMaxInputTokens {
		return fmt.Errorf("VC_BUDGET_MAX_INPUT_TOKENS must be in [1, %d]", hardMaxInputTokens)
	}
	if b.MaxOutputTokens < 1 || b.MaxOutputTokens > hardMaxOutputTokens {
		return fmt.Errorf("VC_BUDGET_MAX_OUTPUT_TOKENS must be in [1, %d]", hardMaxOutputTokens)
	}
	if b.MaxOutputTokens >= b.MaxInputTokens {
		return fmt.Errorf("VC_BUDGET_MAX_OUTPUT_TOKENS must be smaller than VC_BUDGET_MAX_INPUT_TOKENS")
	}
	if b.MaxResponseBytes <= 0 || b.MaxResponseBytes > hardMaxBudgetResponse {
		return fmt.Errorf("VC_BUDGET_MAX_RESPONSE_BYTES must be in (0, %d]", hardMaxBudgetResponse)
	}
	if b.ConnectTimeout <= 0 || b.ConnectTimeout > hardMaxBudgetConnect {
		return fmt.Errorf("VC_BUDGET_CONNECT_TIMEOUT must be in (0, %s]", hardMaxBudgetConnect)
	}
	if b.FirstTokenTimeout <= 0 || b.FirstTokenTimeout > hardMaxBudgetFirstToken {
		return fmt.Errorf("VC_BUDGET_FIRST_TOKEN_TIMEOUT must be in (0, %s]", hardMaxBudgetFirstToken)
	}
	if b.TotalTimeout <= 0 || b.TotalTimeout > hardMaxBudgetTotal {
		return fmt.Errorf("VC_BUDGET_TOTAL_TIMEOUT must be in (0, %s]", hardMaxBudgetTotal)
	}
	if b.ConnectTimeout > b.FirstTokenTimeout || b.FirstTokenTimeout > b.TotalTimeout {
		return fmt.Errorf("VC_BUDGET timeouts must satisfy connect <= first-token <= total")
	}
	if b.MaxAttempts < 1 || b.MaxAttempts > hardMaxAttempts {
		return fmt.Errorf("VC_BUDGET_MAX_ATTEMPTS must be in [1, %d]", hardMaxAttempts)
	}
	if b.MaxReservedCost < 0 || b.MaxReservedCost > hardMaxReservedCost {
		return fmt.Errorf("VC_BUDGET_MAX_RESERVED_COST must be in [0, %d]", hardMaxReservedCost)
	}
	if p.Enabled {
		if b.MaxOutputTokens > p.MaxTokens {
			return fmt.Errorf("VC_BUDGET_MAX_OUTPUT_TOKENS must not exceed VC_PROVIDER_MAX_TOKENS")
		}
		if b.MaxResponseBytes > p.MaxResponseBytes {
			return fmt.Errorf("VC_BUDGET_MAX_RESPONSE_BYTES must not exceed VC_PROVIDER_MAX_RESPONSE_BYTES")
		}
		if b.ConnectTimeout > p.ConnectTimeout || b.FirstTokenTimeout > p.FirstTokenTimeout || b.TotalTimeout > p.TotalTimeout {
			return fmt.Errorf("VC_BUDGET timeouts must not exceed provider timeouts")
		}
	}
	return nil
}

func requireAESKey(b64 string) error {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return fmt.Errorf("must be standard padded base64")
	}
	if len(raw) != 32 {
		return fmt.Errorf("must be 32 bytes (AES-256)")
	}
	return nil
}

func valueOr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func parseHTTPOrigins(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		origin, err := canonicalizeOrigin(part)
		if err != nil {
			return nil, fmt.Errorf("VC_HTTP_ORIGINS: %w", err)
		}
		out = append(out, origin)
	}
	return out, nil
}

func canonicalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("must be an absolute http(s) origin")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("must be an absolute http(s) origin")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("must not include user info, query, or fragment")
	}
	if u.Path != "" && u.Path != "/" {
		return "", fmt.Errorf("must not include a path")
	}
	return u.Scheme + "://" + u.Host, nil
}

func validateOrigins(origins []string) error {
	for _, o := range origins {
		if _, err := canonicalizeOrigin(o); err != nil {
			return fmt.Errorf("VC_HTTP_ORIGINS: %w", err)
		}
	}
	return nil
}

// isLoopbackHost reports whether host is a loopback literal or localhost.
// Used to bound VC_PROVIDER_ALLOW_LOOPBACK_HTTP to loopback endpoints only.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
