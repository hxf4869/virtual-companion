package httpapi

import (
	"encoding/json"
	"strconv"
	"strings"
)

func parsePathID(raw string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func parseOptionalID(raw string) (id int64, set bool, ok bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false, true
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return 0, false, false
	}
	return n, true, true
}

func parseOptionalLimit(raw string) (limit int, set bool, ok bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false, false
	}
	return n, true, true
}

// wireID accepts OpenAPI string ids and the current Java numeric wire form.
type wireID struct {
	V   int64
	Set bool
}

func (id *wireID) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		return nil
	}
	if len(b) > 0 && b[0] == '"' {
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		if err != nil {
			return errInvalidID
		}
		if n <= 0 {
			return errInvalidID
		}
		id.V = n
		id.Set = true
		return nil
	}
	var n int64
	if err := json.Unmarshal(b, &n); err != nil {
		return errInvalidID
	}
	if n <= 0 {
		return errInvalidID
	}
	id.V = n
	id.Set = true
	return nil
}

type idError string

func (e idError) Error() string { return string(e) }

const errInvalidID idError = "invalid id"
