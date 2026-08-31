package bootstrap

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/jackc/pgx/v5"
)

const (
	defaultAdminDisplayName = "管理员"
	maxUsernameRunes        = 128
	maxPasswordRunes        = 128
)

// Config is used only by the one-shot bootstrap container. The steady-state
// companiond process never receives migrator credentials.
type Config struct {
	DSN                string
	OwnerBindingSecret string
	AdminUsername      string
	AdminPassword      string
	AdminDisplayName   string
}

func LoadEnv(getenv func(string) string) (Config, error) {
	if getenv == nil {
		return Config{}, fmt.Errorf("environment reader is required")
	}
	cfg := Config{
		DSN:                strings.TrimSpace(getenv("VC_BOOTSTRAP_DB_DSN")),
		OwnerBindingSecret: getenv("VC_OWNER_BINDING_SECRET"),
		AdminUsername:      strings.ToLower(strings.TrimSpace(getenv("VC_ADMIN_SEED_USERNAME"))),
		AdminPassword:      getenv("VC_ADMIN_SEED_PASSWORD"),
		AdminDisplayName:   strings.TrimSpace(getenv("VC_ADMIN_SEED_DISPLAY_NAME")),
	}
	if cfg.AdminDisplayName == "" {
		cfg.AdminDisplayName = defaultAdminDisplayName
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	if c.DSN == "" {
		return fmt.Errorf("VC_BOOTSTRAP_DB_DSN is required")
	}
	if len(c.OwnerBindingSecret) < 32 {
		return fmt.Errorf("VC_OWNER_BINDING_SECRET must carry at least 32 bytes of key material")
	}
	if (c.AdminUsername == "") != (c.AdminPassword == "") {
		return fmt.Errorf("VC_ADMIN_SEED_USERNAME and VC_ADMIN_SEED_PASSWORD must be set together")
	}
	if c.AdminUsername == "" {
		return nil
	}
	if utf8.RuneCountInString(c.AdminUsername) > maxUsernameRunes ||
		utf8.RuneCountInString(c.AdminPassword) < 8 ||
		utf8.RuneCountInString(c.AdminPassword) > maxPasswordRunes ||
		strings.TrimSpace(c.AdminDisplayName) == "" {
		return fmt.Errorf("administrator seed fields are invalid")
	}
	return nil
}

func Run(ctx context.Context, cfg Config) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	conn, err := pgx.Connect(ctx, cfg.DSN)
	if err != nil {
		return fmt.Errorf("bootstrap database connection failed")
	}
	defer conn.Close(context.Background())

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("bootstrap transaction failed")
	}
	defer tx.Rollback(context.Background())

	var stored string
	err = tx.QueryRow(ctx, `SELECT secret FROM vc._owner_binding_secret WHERE id = 1 FOR UPDATE`).Scan(&stored)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if _, err := tx.Exec(ctx,
			`INSERT INTO vc._owner_binding_secret(id, secret) VALUES (1, $1)`,
			cfg.OwnerBindingSecret); err != nil {
			return fmt.Errorf("owner binding bootstrap failed")
		}
	case err != nil:
		return fmt.Errorf("owner binding bootstrap failed")
	case subtle.ConstantTimeCompare([]byte(stored), []byte(cfg.OwnerBindingSecret)) != 1:
		return fmt.Errorf("VC_OWNER_BINDING_SECRET does not match the initialized database")
	}

	if cfg.AdminUsername != "" {
		hash, err := auth.Hash(cfg.AdminPassword)
		if err != nil {
			return err
		}
		var accountID int64
		if err := tx.QueryRow(ctx,
			`SELECT vc.identity_admin_seed($1, $2, $3)`,
			cfg.AdminUsername, hash, cfg.AdminDisplayName).Scan(&accountID); err != nil {
			return fmt.Errorf("administrator bootstrap failed")
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("bootstrap commit failed")
	}
	return nil
}
