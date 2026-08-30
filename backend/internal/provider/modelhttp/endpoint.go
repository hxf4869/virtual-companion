package modelhttp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

const loopbackIPv4 = "127.0.0.1"

var (
	errRedirect = errors.New("provider redirect is disabled")
	errBlocked  = errors.New("provider endpoint host is not allowed")
	errDNS      = errors.New("provider endpoint host cannot be used")
)

// ResolveEndpoint validates an administrator-supplied base URL and appends the
// fixed protocol path. A conventional base ending in /v1 receives only the
// path leaf; other bases receive the complete /v1/... suffix.
func ResolveEndpoint(baseURL, protocol string, allowLoopbackHTTP bool) (*url.URL, error) {
	path, err := protocolPath(protocol)
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("provider base URL must be absolute")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" {
		return nil, fmt.Errorf("provider base URL must not include user info, query, fragment, or encoded path")
	}
	if strings.Contains(u.Path, "//") || strings.Contains(u.Path, "/./") ||
		strings.Contains(u.Path, "/../") || strings.HasSuffix(u.Path, "/..") ||
		strings.HasSuffix(u.Path, "/.") {
		return nil, fmt.Errorf("provider base URL path is invalid")
	}
	basePath := strings.TrimRight(u.Path, "/")
	for _, terminal := range []string{"/chat/completions", "/responses", "/messages", "/models"} {
		if strings.HasSuffix(basePath, terminal) {
			return nil, fmt.Errorf("provider base URL must not include a protocol endpoint")
		}
	}
	if strings.HasSuffix(basePath, "/v1") {
		u.Path = basePath + strings.TrimPrefix(path, "/v1")
	} else {
		u.Path = basePath + path
	}
	if u.Path == "" || u.Path[0] != '/' {
		u.Path = "/" + u.Path
	}
	if err := validateHostScheme(u, allowLoopbackHTTP); err != nil {
		return nil, err
	}
	return u, nil
}

// ResolveModelsEndpoint resolves the standard model catalog beside the
// protocol endpoints. It intentionally supports only /v1/models.
func ResolveModelsEndpoint(baseURL string, allowLoopbackHTTP bool) (*url.URL, error) {
	// Reuse the complete base validation, then replace only the fixed leaf.
	u, err := ResolveEndpoint(baseURL, "OPENAI_RESPONSES", allowLoopbackHTTP)
	if err != nil {
		return nil, err
	}
	u.Path = strings.TrimSuffix(u.Path, "/responses") + "/models"
	return u, nil
}

func protocolPath(protocol string) (string, error) {
	switch protocol {
	case "OPENAI_CHAT_COMPLETIONS":
		return "/v1/chat/completions", nil
	case "OPENAI_RESPONSES":
		return "/v1/responses", nil
	case "ANTHROPIC_MESSAGES":
		return "/v1/messages", nil
	default:
		return "", fmt.Errorf("provider protocol is unsupported")
	}
}

func validateHostScheme(u *url.URL, allowLoopbackHTTP bool) error {
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("provider base URL must include a host")
	}
	if strings.Contains(host, ":") {
		return fmt.Errorf("provider base URL must not use an IPv6 literal host")
	}
	scheme := strings.ToLower(u.Scheme)
	if host == loopbackIPv4 {
		if scheme != "https" && !(allowLoopbackHTTP && scheme == "http") {
			return fmt.Errorf("provider loopback URL must use https, or http when local dogfood is enabled")
		}
		return nil
	}
	if scheme != "https" {
		return fmt.Errorf("provider base URL must use https")
	}
	if net.ParseIP(host) != nil {
		return fmt.Errorf("provider base URL host is not allowed")
	}
	return requireHostname(host)
}

func requireHostname(host string) error {
	host = strings.ToLower(host)
	if strings.HasPrefix(host, ".") || strings.HasSuffix(host, ".") || !strings.Contains(host, ".") {
		return fmt.Errorf("provider base URL host is not allowed")
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return fmt.Errorf("provider base URL host is not allowed")
		}
		for i := 0; i < len(label); {
			r, n := utf8.DecodeRuneInString(label[i:])
			if r == utf8.RuneError && n == 1 {
				return fmt.Errorf("provider base URL host is not allowed")
			}
			if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-') {
				return fmt.Errorf("provider base URL host is not allowed")
			}
			i += n
		}
	}
	return nil
}

func sameEndpoint(want, got *url.URL) bool {
	if want == nil || got == nil || !strings.EqualFold(want.Scheme, got.Scheme) ||
		!strings.EqualFold(want.Hostname(), got.Hostname()) ||
		effectivePort(want) != effectivePort(got) {
		return false
	}
	return want.EscapedPath() == got.EscapedPath()
}

func effectivePort(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	if strings.EqualFold(u.Scheme, "https") {
		return "443"
	}
	if strings.EqualFold(u.Scheme, "http") {
		return "80"
	}
	return ""
}

func denyRedirect(*http.Request, []*http.Request) error { return errRedirect }
func noProxy(*http.Request) (*url.URL, error)           { return nil, nil }

type lookupFunc func(context.Context, string) ([]net.IPAddr, error)

func defaultLookup(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

func blockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		a, b := v4[0], v4[1]
		return a == 0 || a == 10 || (a == 100 && b >= 64 && b <= 127) ||
			a == 127 || (a == 169 && b == 254) ||
			(a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || a >= 224
	}
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsPrivate() {
		return true
	}
	if len(ip) == net.IPv6len && ip[0] == 0x00 && ip[1] == 0x64 && ip[2] == 0xff && ip[3] == 0x9b {
		return blockedIP(net.IPv4(ip[12], ip[13], ip[14], ip[15]))
	}
	return false
}
