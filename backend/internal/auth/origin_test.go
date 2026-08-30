package auth

import "testing"

func TestParseAndAllowOrigin(t *testing.T) {
	t.Parallel()
	got, err := ParseOrigins("https://vc.test, http://127.0.0.1:5173")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "https://vc.test" || got[1] != "http://127.0.0.1:5173" {
		t.Fatalf("%q", got)
	}
	if !AllowOrigin("https://vc.test", got) {
		t.Fatal("allow")
	}
	if AllowOrigin("https://evil.test", got) || AllowOrigin("", got) {
		t.Fatal("deny")
	}
}

func TestParseOriginsRejectsPathAndUser(t *testing.T) {
	t.Parallel()
	if _, err := ParseOrigins("https://vc.test/app"); err == nil {
		t.Fatal("path")
	}
	if _, err := ParseOrigins("https://u:p@vc.test"); err == nil {
		t.Fatal("user")
	}
	if _, err := ParseOrigins("ftp://vc.test"); err == nil {
		t.Fatal("scheme")
	}
}

func TestCookieTokenRejectsBadValues(t *testing.T) {
	t.Parallel()
	if CookieToken(nil) != "" {
		t.Fatal("nil")
	}
}
