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
	JWT          JWT
	Crypto       Crypto
	Provider     Provider
	Budget       Budget
}

// Provider is the single OpenAI-compatible Chat Completions adapter.
// Enabled=false (the default) leaves chat unwired; companiond does not
// construct the adapter in G4. Missing credential/endpoint while Enabled
// fails startup. Secrets never log.
type Provider struct {
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

// JWT is the migration-window HS256 verifier config. Go never issues JWT.
type JWT struct {
	Secret string
	Issuer string
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
		Database: Database{
			DSN:       strings.TrimSpace(getenv("VC_DB_DSN")),
			MaxConns:  8,
			TxTimeout: 5 * time.Second,
		},
		OwnerBinding: OwnerBinding{Secret: getenv("VC_OWNER_BINDING_SECRET")},
		JWT: JWT{
			Secret: getenv("VC_JWT_SECRET"),
			Issuer: valueOr(strings.TrimSpace(getenv("VC_AUTH_ISSUER")), "virtual-companion"),
		},
		Crypto: Crypto{
			RestKeyID:              valueOr(strings.TrimSpace(getenv("VC_CRYPTO_REST_KEY_ID")), "default"),
			RestKeyVersion:         1,
			RestKeyBase64:          strings.TrimSpace(getenv("VC_CRYPTO_REST_KEY")),
			PreviousRestKeyID:      strings.TrimSpace(getenv("VC_CRYPTO_PREVIOUS_REST_KEY_ID")),
			PreviousRestKeyVersion: 0,
			PreviousRestKeyBase64:  strings.TrimSpace(getenv("VC_CRYPTO_PREVIOUS_REST_KEY")),
		},
		Provider: Provider{
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
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
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
	if c.JWT.Secret != "" {
		if len(c.JWT.Secret) < 32 {
			return fmt.Errorf("VC_JWT_SECRET must be at least 256 bits")
		}
		if strings.TrimSpace(c.JWT.Issuer) == "" {
			return fmt.Errorf("VC_AUTH_ISSUER is required when VC_JWT_SECRET is set")
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
		if !strings.EqualFold(u.Scheme, "https") {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT must use https")
		}
		if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT must not include user info, query, or fragment")
		}
		if !strings.HasSuffix(u.EscapedPath(), "/v1/chat/completions") {
			return fmt.Errorf("VC_PROVIDER_ENDPOINT path must end with /v1/chat/completions")
		}
	}
	return c.Budget.validate(c.Provider)
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
