package openai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
)

var (
	errRedirect = errors.New("provider redirect is disabled")
	errBlocked  = errors.New("provider endpoint host is not allowed")
	errDNS      = errors.New("provider endpoint host cannot be used")
)

func sameApprovedEndpoint(endpoint, got *url.URL) bool {
	if endpoint == nil || got == nil {
		return false
	}
	if !strings.EqualFold(endpoint.Scheme, got.Scheme) {
		return false
	}
	if !strings.EqualFold(endpoint.Hostname(), got.Hostname()) {
		return false
	}
	if effectivePort(endpoint) != effectivePort(got) {
		return false
	}
	return endpoint.EscapedPath() == got.EscapedPath()
}

func effectivePort(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return "443"
	case "http":
		return "80"
	default:
		return ""
	}
}

func (a *Adapter) dialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, errDNS
	}
	d := net.Dialer{Timeout: a.cfg.ConnectTimeout}
	if host == loopbackIPv4 {
		return d.DialContext(ctx, network, addr)
	}
	ips, err := a.lookup(ctx, host)
	if err != nil {
		return nil, errDNS
	}
	if len(ips) == 0 {
		return nil, errDNS
	}
	for _, ip := range ips {
		if blockedIP(ip.IP) != "" {
			return nil, errBlocked
		}
	}
	var first error
	for _, ip := range ips {
		target := net.JoinHostPort(ip.IP.String(), port)
		conn, dialErr := d.DialContext(ctx, network, target)
		if dialErr == nil {
			return conn, nil
		}
		if first == nil {
			first = errDNS
		}
	}
	if first == nil {
		return nil, errDNS
	}
	return nil, first
}

func defaultLookup(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

func blockedIP(ip net.IP) string {
	if ip == nil {
		return "empty"
	}
	if v4 := ip.To4(); v4 != nil {
		return blockedIPv4(v4)
	}
	return blockedIPv6(ip)
}

func blockedIPv4(v4 net.IP) string {
	if len(v4) < 4 {
		return "empty"
	}
	a, b := v4[0], v4[1]
	switch {
	case a == 0:
		return "any-local"
	case a == 10:
		return "private"
	case a == 100 && b >= 64 && b <= 127:
		return "cgnat"
	case a == 127:
		return "loopback"
	case a == 169 && b == 254:
		return "link-local"
	case a == 172 && b >= 16 && b <= 31:
		return "private"
	case a == 192 && b == 168:
		return "private"
	case a >= 224:
		return "multicast"
	default:
		return ""
	}
}

func blockedIPv6(ip net.IP) string {
	if ip.IsLoopback() {
		return "loopback"
	}
	if ip.IsUnspecified() {
		return "unspecified"
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return "link-local"
	}
	if ip.IsMulticast() {
		return "multicast"
	}
	if ip.IsPrivate() {
		return "private"
	}
	if len(ip) == net.IPv6len && ip[0] == 0x00 && ip[1] == 0x64 && ip[2] == 0xff && ip[3] == 0x9b {
		mapped := net.IPv4(ip[12], ip[13], ip[14], ip[15])
		if reason := blockedIPv4(mapped.To4()); reason != "" {
			return reason
		}
	}
	return ""
}

func denyRedirect(*http.Request, []*http.Request) error {
	return errRedirect
}

func noProxy(*http.Request) (*url.URL, error) {
	return nil, nil
}
