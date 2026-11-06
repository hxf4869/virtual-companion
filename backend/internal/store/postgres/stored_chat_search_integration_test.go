//go:build integration

package postgres

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"testing"
	"time"
)

func TestStoredChatSparseSearchBudget(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 20000)
	s := testEnv.store
	ctx := context.Background()
	err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		start := time.Now()
		_, epoch, err := lockChatAuthority(ctx, tx, 1, false)
		if err != nil {
			return err
		}
		_, err = s.readStoredChat(ctx, tx, 1, c.ChatID, epoch)
		if err != nil {
			return err
		}
		t.Logf("read fence %s", time.Since(start))
		keys, err := s.storedMessageKeys(ctx, tx, 1, c.ChatID, nil, false, false, "needle", 1)
		t.Logf("bounded search elapsed=%s count=%d err=%v context=%v", time.Since(start), len(keys), err, ctx.Err())
		if err != nil {
			return err
		}
		ms, err := s.loadStoredMessagePage(ctx, tx, 1, c.ChatID, keys, "display", false)
		t.Logf("load page elapsed=%s count=%d err=%v context=%v", time.Since(start), len(ms), err, ctx.Err())
		if err != nil {
			return err
		}
		if len(keys) != 1 || keys[0].ID != syntheticMessageID(19999) || len(ms) != 1 {
			return errors.New("sparse search returned an incomplete page")
		}
		bound := keys[0].Position
		older, err := s.storedMessageKeys(ctx, tx, 1, c.ChatID, &bound, false, false, "needle", 1)
		t.Logf("older search elapsed=%s count=%d err=%v context=%v", time.Since(start), len(older), err, ctx.Err())
		if err == nil && (len(older) != 1 || older[0].ID != syntheticMessageID(1)) {
			return errors.New("sparse search missed the oldest match")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}
