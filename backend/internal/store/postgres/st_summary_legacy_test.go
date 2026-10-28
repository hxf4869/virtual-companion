package postgres

// The retired extractive summary is retained only as a historical regression fixture.
import (
	"context"
	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

func (s *Store) refreshSTSummary(ctx context.Context, owner, conversation int64) error {
	return mapStoreErr(s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT source_ref,content_cipher,source_timestamp,source_timezone,source_position FROM vc.st_message_source
            WHERE owner_user_id=$1 AND conversation_id=$2 AND present AND settled AND eligible AND NOT suppressed AND role='user'
            ORDER BY source_position DESC,id DESC LIMIT 12`, owner, conversation)
		if err != nil {
			return err
		}
		sources := []stDigestSource{}
		for rows.Next() {
			var d stDigestSource
			if err := rows.Scan(&d.ref, &d.text, &d.at, &d.timezone, &d.position); err != nil {
				rows.Close()
				return err
			}
			sources = append(sources, d)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(sources) == 0 {
			return nil
		}
		refs := []string{}
		texts := []string{}
		for i := len(sources) - 1; i >= 0; i-- {
			d := sources[i]
			plain := d.text
			r := []rune(plain)
			if len(r) > 160 {
				plain = string(r[:160]) + "…"
			}
			var at time.Time
			if d.at != nil {
				at = *d.at
			}
			normalized := memorytime.Normalize(plain, at, valueOrEmpty(d.timezone))
			label := ""
			if normalized.EventDate != nil {
				label = "（事件日期=" + *normalized.EventDate + "）"
			} else if normalized.NormalizationStatus == memorytime.StatusNeedsClarification {
				label = "（时间待澄清）"
			}
			texts = append(texts, "「"+plain+"」"+label)
			refs = append(refs, d.ref)
		}
		stored := strings.Join(texts, "；")
		_, err = tx.Exec(ctx, `SELECT vc.record_st_summary($1,$2,$3,$4)`, owner, conversation, refs, stored)
		return err
	}))
}
