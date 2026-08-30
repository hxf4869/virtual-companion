package modelhttp

import "testing"

func TestResolveEndpointAcceptsConventionalV1Base(t *testing.T) {
	t.Parallel()
	u, err := ResolveEndpoint("https://gateway.example/prefix/v1", "OPENAI_RESPONSES", false)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := u.String(), "https://gateway.example/prefix/v1/responses"; got != want {
		t.Fatalf("endpoint %q want %q", got, want)
	}
}

func TestResolveEndpointAppendsFullPathToOrigin(t *testing.T) {
	t.Parallel()
	u, err := ResolveEndpoint("https://api.example", "ANTHROPIC_MESSAGES", false)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := u.String(), "https://api.example/v1/messages"; got != want {
		t.Fatalf("endpoint %q want %q", got, want)
	}
}

func TestResolveEndpointRejectsTerminalPathAndPlainHTTP(t *testing.T) {
	t.Parallel()
	for _, base := range []string{
		"https://api.example/v1/chat/completions",
		"http://api.example/v1",
		"https://api.example/v1?",
	} {
		if _, err := ResolveEndpoint(base, "OPENAI_CHAT_COMPLETIONS", false); err == nil {
			t.Fatalf("accepted %q", base)
		}
	}
	if _, err := ResolveEndpoint("https://127.0.0.1/v1", "OPENAI_CHAT_COMPLETIONS", false); err != nil {
		t.Fatalf("TLS loopback endpoint: %v", err)
	}
	if _, err := ResolveEndpoint("http://127.0.0.1:8080/v1", "OPENAI_CHAT_COMPLETIONS", true); err != nil {
		t.Fatalf("explicit local dogfood endpoint: %v", err)
	}
}
