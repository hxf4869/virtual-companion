package stsource

import (
	"context"
	"errors"
	"strconv"
)

var ErrExportTooLarge = errors.New("ST export exceeds the supported size")

// DataClient is the same private service identity as the source reader. The
// caller persists deletion intent before invoking Delete; a failed response
// never means that external data was removed.
type DataClient interface {
	Export(context.Context, int64) (AccountExport, error)
	Delete(context.Context, int64, string) (AccountDeletion, error)
}
type ExportFile struct {
	Path       string `json:"path"`
	Encoding   string `json:"encoding"`
	Data       string `json:"data"`
	Bytes      int64  `json:"bytes"`
	CapturedAt string `json:"capturedAt"`
	ModifiedAt string `json:"modifiedAt"`
}
type AccountExport struct {
	OwnerAccountID string       `json:"ownerAccountId"`
	Handle         string       `json:"handle"`
	State          string       `json:"state"`
	StartedAt      string       `json:"startedAt"`
	CompletedAt    string       `json:"completedAt"`
	Snapshot       string       `json:"snapshot"`
	FileCount      int          `json:"fileCount"`
	Bytes          int64        `json:"bytes"`
	Files          []ExportFile `json:"files"`
	Exclusions     []string     `json:"exclusions"`
}
type AccountDeletion struct {
	OwnerAccountID string `json:"ownerAccountId"`
	Handle         string `json:"handle"`
	State          string `json:"state"`
}

func (c *Client) Export(ctx context.Context, owner int64) (AccountExport, error) {
	var out AccountExport
	if c == nil || owner <= 0 {
		return out, ErrUnavailable
	}
	id := strconv.FormatInt(owner, 10)
	if err := c.callLimit(ctx, "/internal/v1/st/data/export", map[string]string{"ownerAccountId": id}, &out, 128<<20); err != nil {
		return AccountExport{}, err
	}
	if out.OwnerAccountID != id || out.Handle == "" || out.State != "COMPLETE" || out.Snapshot != "PER_FILE" || out.StartedAt == "" || out.CompletedAt == "" || out.Files == nil || out.FileCount != len(out.Files) {
		return AccountExport{}, ErrUnavailable
	}
	return out, nil
}
func (c *Client) Delete(ctx context.Context, owner int64, expectedHandle string) (AccountDeletion, error) {
	var out AccountDeletion
	if c == nil || owner <= 0 {
		return out, ErrUnavailable
	}
	id := strconv.FormatInt(owner, 10)
	if err := c.call(ctx, "/internal/v1/st/data/delete", map[string]string{"ownerAccountId": id, "expectedHandle": expectedHandle}, &out); err != nil {
		return AccountDeletion{}, err
	}
	if out.OwnerAccountID != id || out.Handle == "" || out.State != "DELETED" || expectedHandle != "" && out.Handle != expectedHandle {
		return AccountDeletion{}, ErrUnavailable
	}
	return out, nil
}
