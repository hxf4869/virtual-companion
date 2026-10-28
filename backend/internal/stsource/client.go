// Package stsource reads the persisted SillyTavern authority over the private
// service channel. It never turns a missing response or file into a deletion.
package stsource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var ErrUnavailable = errors.New("ST source temporarily unavailable")
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var inboxEventID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func ValidIdentity(id string) bool { return uuid.MatchString(id) }

type Query struct {
	ChatIdentity string `json:"chatIdentity"`
	Revision     *int64 `json:"revision,omitempty"`
}
type Message struct {
	MessageID       string     `json:"messageId"`
	CandidateID     string     `json:"candidateId"`
	Revision        int64      `json:"revision"`
	Role            string     `json:"role"`
	Text            string     `json:"text"`
	Settled         bool       `json:"settled"`
	Eligible        bool       `json:"eligible"`
	SourceTimestamp *time.Time `json:"sourceTimestamp"`
	SourceTimezone  string     `json:"sourceTimezone"`
	InboxEventID    string     `json:"inboxEventId,omitempty"`
}
type Snapshot struct {
	ChatIdentity string    `json:"chatIdentity"`
	State        string    `json:"state"`
	Revision     int64     `json:"revision"`
	Location     string    `json:"location,omitempty"`
	NotModified  bool      `json:"notModified,omitempty"`
	Messages     []Message `json:"messages,omitempty"`
	BranchRoot   string    `json:"branchRoot,omitempty"`
}
type Reader interface {
	Read(context.Context, int64, []Query) ([]Snapshot, error)
}
type Client struct {
	base, token string
	http        *http.Client
}

func NewClient(base, token string) (*Client, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(token) < 32 {
		return nil, fmt.Errorf("invalid ST host service configuration")
	}
	return &Client{base: strings.TrimRight(base, "/"), token: token, http: &http.Client{Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}
func (c *Client) call(ctx context.Context, path string, input, output any) error {
	return c.callLimit(ctx, path, input, output, 32<<20)
}
func (c *Client) callLimit(ctx context.Context, path string, input, output any, limit int64) error {
	raw, err := json.Marshal(input)
	if err != nil {
		return ErrUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(raw))
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusRequestEntityTooLarge && path == "/internal/v1/st/data/export" {
		return ErrExportTooLarge
	}
	if res.StatusCode != http.StatusOK {
		return ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil || int64(len(body)) > limit || json.Unmarshal(body, output) != nil {
		return ErrUnavailable
	}
	return nil
}
func (c *Client) Read(ctx context.Context, owner int64, queries []Query) ([]Snapshot, error) {
	if c == nil || owner <= 0 || len(queries) == 0 || len(queries) > 64 {
		return nil, ErrUnavailable
	}
	wanted := make(map[string]Query, len(queries))
	for _, q := range queries {
		if !ValidIdentity(q.ChatIdentity) || (q.Revision != nil && *q.Revision < 0) {
			return nil, ErrUnavailable
		}
		if _, ok := wanted[q.ChatIdentity]; ok {
			return nil, ErrUnavailable
		}
		wanted[q.ChatIdentity] = q
	}
	input := struct {
		Owner string  `json:"ownerAccountId"`
		Chats []Query `json:"chats"`
	}{strconv.FormatInt(owner, 10), queries}
	var output struct {
		Owner     string     `json:"ownerAccountId"`
		Snapshots []Snapshot `json:"snapshots"`
	}
	if err := c.call(ctx, "/internal/v1/st/sources", input, &output); err != nil {
		return nil, err
	}
	if output.Owner != input.Owner || len(output.Snapshots) != len(queries) {
		return nil, ErrUnavailable
	}
	for _, snap := range output.Snapshots {
		query, ok := wanted[snap.ChatIdentity]
		if !ok {
			return nil, ErrUnavailable
		}
		delete(wanted, snap.ChatIdentity)
		switch snap.State {
		case "PRESENT":
			if snap.BranchRoot != "" && !ValidIdentity(snap.BranchRoot) {
				return nil, ErrUnavailable
			}
			if snap.Revision < 0 || snap.Location == "" || (!snap.NotModified && snap.Messages == nil) || (snap.NotModified && (query.Revision == nil || *query.Revision != snap.Revision || len(snap.Messages) > 0)) {
				return nil, ErrUnavailable
			}
			seen := make(map[string]bool, len(snap.Messages))
			for _, m := range snap.Messages {
				if !ValidIdentity(m.MessageID) || !ValidIdentity(m.CandidateID) || m.Revision < 1 || seen[m.MessageID] || (m.Role != "user" && m.Role != "assistant" && m.Role != "system") || (m.InboxEventID != "" && !inboxEventID.MatchString(m.InboxEventID)) {
					return nil, ErrUnavailable
				}
				seen[m.MessageID] = true
			}
		case "DELETED":
			if snap.Revision < 1 || snap.NotModified || len(snap.Messages) > 0 {
				return nil, ErrUnavailable
			}
		case "UNKNOWN", "UNAVAILABLE":
			if snap.NotModified || len(snap.Messages) > 0 {
				return nil, ErrUnavailable
			}
		default:
			return nil, ErrUnavailable
		}
	}
	return output.Snapshots, nil
}

type Ref struct {
	Chat, Message, Candidate string
	Revision, Generation     int64
}

func (r Ref) String() string {
	return fmt.Sprintf("st:%s:%s:%s:%d:%d", r.Chat, r.Message, r.Candidate, r.Revision, r.Generation)
}
func ParseRef(raw string) (Ref, bool) {
	fields := strings.Split(raw, ":")
	if len(fields) != 6 || fields[0] != "st" || !ValidIdentity(fields[1]) || !ValidIdentity(fields[2]) || !ValidIdentity(fields[3]) {
		return Ref{}, false
	}
	revision, e1 := strconv.ParseInt(fields[4], 10, 64)
	generation, e2 := strconv.ParseInt(fields[5], 10, 64)
	if e1 != nil || e2 != nil || revision < 1 || generation < 1 {
		return Ref{}, false
	}
	r := Ref{fields[1], fields[2], fields[3], revision, generation}
	return r, r.String() == raw
}
