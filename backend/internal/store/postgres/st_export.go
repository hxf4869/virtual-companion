package postgres

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

type V2OwnerExport struct {
	Go      map[string]any          `json:"go"`
	ST      *stsource.AccountExport `json:"st,omitempty"`
	Domains []ExportDomain          `json:"domains"`
}
type ExportDomain struct {
	System  string `json:"system"`
	State   string `json:"state"`
	Records int    `json:"records"`
	Note    string `json:"note,omitempty"`
}

func (s *Store) ExportV2OwnerData(ctx context.Context, owner int64) (V2OwnerExport, error) {
	out := V2OwnerExport{}
	// An explicit full export may enumerate this owner's bindings. Normal
	// recall continues to use only its bounded candidate dependency set.
	var chats []string
	if err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT st_chat_identity FROM vc.conversation WHERE owner_user_id=$1 AND st_chat_identity IS NOT NULL`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			if stsource.ValidIdentity(id) {
				chats = append(chats, id)
			}
		}
		return rows.Err()
	}); err != nil {
		return out, mapStoreErr(err)
	}
	for start := 0; start < len(chats); start += 64 {
		if _, err := s.ReconcileSTSources(ctx, owner, chats[start:min(start+64, len(chats))]); err != nil {
			return out, err
		}
	}
	var raw []byte
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.export_v2_owner_metadata($1)`, owner).Scan(&raw)
	})
	if err != nil {
		return out, mapStoreErr(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&out.Go) != nil {
		return out, errStore
	}
	for _, domain := range []struct{ name, field string }{{"sources", "content"}, {"summaries", "content"}, {"extractionResults", "output"}, {"reminders", "text"}} {
		rows, ok := out.Go[domain.name].([]any)
		if !ok {
			return out, errStore
		}
		for _, value := range rows {
			row, ok := value.(map[string]any)
			if !ok {
				return out, errStore
			}
			if row[domain.field] == nil {
				continue
			}
			stored, ok := row[domain.field].(string)
			if !ok {
				return out, errStore
			}
			plain, err := s.decryptStored(stored)
			if err != nil {
				return out, errStore
			}
			row[domain.field] = plain
		}
	}
	count := 0
	for _, value := range out.Go {
		if rows, ok := value.([]any); ok {
			count += len(rows)
		}
	}
	out.Domains = []ExportDomain{{System: "GO_METADATA_SOURCES_TASKS_RESULTS", State: "COMPLETE", Records: count},
		{System: "EXTERNAL_MEMORY_ENGINE", State: "NOT_APPLICABLE", Note: "No external memory engine is connected."},
		{System: "BACKUPS", State: "EXCLUDED", Note: "Historical and offline backups are not merged into this online copy; online private backups are included in account deletion."},
		{System: "CREDENTIALS", State: "EXCLUDED", Note: "API keys, authentication secrets, session tokens and internal leases are excluded."}}
	if s.stData != nil {
		data, err := s.stData.Export(ctx, owner)
		if err != nil {
			return out, err
		}
		out.ST = &data
		out.Domains = append(out.Domains, ExportDomain{System: "ST_PRIVATE_CONTENT", State: "COMPLETE", Records: data.FileCount, Note: "Per-file capture times; regenerable caches and historical backups excluded."})
	} else {
		var needsST bool
		if err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT vc.requires_st_account_cleanup_current()`).Scan(&needsST)
		}); err != nil {
			return out, mapStoreErr(err)
		}
		if needsST {
			return out, stsource.ErrUnavailable
		}
		out.Domains = append(out.Domains, ExportDomain{System: "ST_PRIVATE_CONTENT", State: "NOT_APPLICABLE", Note: "No ST service, registered profile or chat binding configured."})
	}
	return out, nil
}
