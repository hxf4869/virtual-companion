package auth

import (
	"net/url"
	"strings"
)

// ParseOrigins splits a comma-separated allowlist of exact origins.
func ParseOrigins(raw string) ([]string, error) {
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
			return nil, err
		}
		out = append(out, origin)
	}
	return out, nil
}

func canonicalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", errInvalidOrigin
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errInvalidOrigin
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errInvalidOrigin
	}
	if u.Path != "" && u.Path != "/" {
		return "", errInvalidOrigin
	}
	return u.Scheme + "://" + u.Host, nil
}

// AllowOrigin reports an exact match against the allowlist. Missing origin fails closed.
func AllowOrigin(origin string, allowed []string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" || len(allowed) == 0 {
		return false
	}
	for _, a := range allowed {
		if origin == a {
			return true
		}
	}
	return false
}

type originError string

func (e originError) Error() string { return string(e) }

const errInvalidOrigin originError = "must be an absolute http(s) origin without path, query, or user info"
