package migrate

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

const memoryPageSize = 256

// This one-off conversion deliberately uses no runtime dual-read fallback.
// Cipher errors omit row identifiers and contents from the migration output.
func memoryPlaintext(stored string, decrypt func(string) (string, error)) (string, error) {
	if !strings.HasPrefix(stored, "enc1:") && !strings.HasPrefix(stored, "enc2:") {
		return stored, nil
	}
	if decrypt == nil {
		return "", fmt.Errorf("memory conversion requires the current/previous field cipher keys")
	}
	plain, err := decrypt(stored)
	if err != nil {
		return "", fmt.Errorf("memory field decryption failed; verify current/previous keys and envelope integrity")
	}
	return plain, nil
}

func migrateMemoryPlaintext(ctx context.Context, tx pgx.Tx, decrypt func(string) (string, error)) error {
	// Never silently convert a subset when a schema credential is subject to FORCE RLS.
	if _, err := tx.Exec(ctx, `SET LOCAL row_security=off;
 LOCK TABLE vc.account_deletion_intent,vc.memory_item,vc.conversation_summary,
 vc.st_message_source,vc.memory_extract_attempt,vc.memory_import_bundle IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return fmt.Errorf("memory conversion lock failed")
	}
	var deleting bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.account_deletion_intent d JOIN vc.vc_user u ON u.id=d.account_id)`).Scan(&deleting); err != nil {
		return fmt.Errorf("memory deletion preflight failed")
	}
	if deleting {
		return fmt.Errorf("finish existing account deletion before memory conversion")
	}
	for _, target := range []struct{ table, column string }{
		{"memory_item", "summary"}, {"memory_item", "temporal_cipher"},
		{"conversation_summary", "summary"}, {"st_message_source", "content_cipher"},
		{"memory_extract_attempt", "output_payload"},
	} {
		if err := convertMemoryColumn(ctx, tx, target.table, target.column, decrypt); err != nil {
			return fmt.Errorf("%s.%s: %w", target.table, target.column, err)
		}
	}
	return convertMemoryBundles(ctx, tx, decrypt)
}

func convertMemoryColumn(ctx context.Context, tx pgx.Tx, table, column string, decrypt func(string) (string, error)) error {
	// Identifiers come exclusively from the fixed list above.
	name := pgx.Identifier{"vc", table}.Sanitize()
	col := pgx.Identifier{column}.Sanitize()
	var owner, id int64
	for {
		rows, err := tx.Query(ctx, `SELECT owner_user_id,id,`+col+` FROM `+name+` WHERE (owner_user_id,id)>($1,$2) AND `+col+` IS NOT NULL ORDER BY owner_user_id,id LIMIT $3`, owner, id, memoryPageSize)
		if err != nil {
			return fmt.Errorf("memory page read failed")
		}
		type row struct {
			owner, id int64
			text      string
		}
		page := []row{}
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.owner, &r.id, &r.text); err != nil {
				rows.Close()
				return fmt.Errorf("memory page decode failed")
			}
			page = append(page, r)
		}
		rows.Close()
		if rows.Err() != nil {
			return fmt.Errorf("memory page read failed")
		}
		if len(page) == 0 {
			return nil
		}
		for _, r := range page {
			plain, err := memoryPlaintext(r.text, decrypt)
			if err != nil {
				return err
			}
			if plain != r.text {
				if _, err := tx.Exec(ctx, `UPDATE `+name+` SET `+col+`=$3 WHERE owner_user_id=$1 AND id=$2`, r.owner, r.id, plain); err != nil {
					return fmt.Errorf("memory conversion write failed")
				}
			}
			owner, id = r.owner, r.id
		}
	}
}

func convertMemoryBundles(ctx context.Context, tx pgx.Tx, decrypt func(string) (string, error)) error {
	var owner int64
	var persona string
	for {
		rows, err := tx.Query(ctx, `SELECT owner_user_id,persona_ref,payload FROM vc.memory_import_bundle WHERE (owner_user_id,persona_ref)>($1,$2) ORDER BY owner_user_id,persona_ref LIMIT $3`, owner, persona, memoryPageSize)
		if err != nil {
			return fmt.Errorf("memory import page read failed")
		}
		type row struct {
			owner   int64
			persona string
			payload []byte
		}
		page := []row{}
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.owner, &r.persona, &r.payload); err != nil {
				rows.Close()
				return fmt.Errorf("memory import page decode failed")
			}
			page = append(page, r)
		}
		rows.Close()
		if rows.Err() != nil {
			return fmt.Errorf("memory import page read failed")
		}
		if len(page) == 0 {
			return nil
		}
		for _, r := range page {
			var items []map[string]json.RawMessage
			if err := json.Unmarshal(r.payload, &items); err != nil {
				return fmt.Errorf("memory import payload is not an array of objects")
			}
			changed := false
			for _, item := range items {
				raw, ok := item["summary"]
				if !ok || string(raw) == "null" {
					continue
				}
				var stored string
				if err := json.Unmarshal(raw, &stored); err != nil {
					return fmt.Errorf("memory import summary is not text")
				}
				plain, err := memoryPlaintext(stored, decrypt)
				if err != nil {
					return err
				}
				if plain != stored {
					item["summary"], _ = json.Marshal(plain)
					changed = true
				}
			}
			if changed {
				payload, err := json.Marshal(items)
				if err != nil {
					return fmt.Errorf("memory import encoding failed")
				}
				if _, err := tx.Exec(ctx, `UPDATE vc.memory_import_bundle SET payload=$3::jsonb WHERE owner_user_id=$1 AND persona_ref=$2`, r.owner, r.persona, string(payload)); err != nil {
					return fmt.Errorf("memory import conversion write failed")
				}
			}
			owner, persona = r.owner, r.persona
		}
	}
}
