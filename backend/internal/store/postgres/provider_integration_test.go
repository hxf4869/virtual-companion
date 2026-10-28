//go:build integration

package postgres

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

func resetCatalogFixtures(t *testing.T) *Store {
	t.Helper()
	ctx := context.Background()
	for _, stmt := range []string{
		`TRUNCATE vc.provider_model, vc.provider_config, vc.provider_deployment,
		          vc.identity_auth_event, vc.identity_opaque_session,
		          vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE`,
		`INSERT INTO vc.model_purpose_binding(purpose, state, updated_by)
		 VALUES ('FOREGROUND_CHAT', 'DISABLED', 0), ('MEMORY_EXTRACTION_DEDUP_SUMMARY', 'DISABLED', 0),
		        ('BACKGROUND_GREETINGS', 'DISABLED', 0), ('STORY_DIRECTOR', 'DISABLED', 0),
		        ('NPC_DIALOGUE', 'DISABLED', 0), ('EMBEDDING', 'DISABLED', 0)
		 ON CONFLICT (purpose) DO UPDATE
		    SET provider_id = NULL, profile_key = NULL, state = 'DISABLED', revision = 1`,
		`INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'owner'), (2, 'disabled owner'), (7, 'admin')`,
		`INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
		 VALUES (1, 'owner', 'hash', 'USER', 'ACTIVE', 'owner'),
		        (2, 'disabled', 'hash', 'USER', 'DISABLED', 'disabled owner'),
		        (7, 'admin', 'hash', 'ADMIN', 'ACTIVE', 'admin')`,
	} {
		if err := IsolationSuperExec(ctx, stmt); err != nil {
			t.Fatalf("fixture %q: %v", stmt[:40], err)
		}
	}
	store := testEnv.store
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	return store
}

func catalogModel(profileKey, modelID string, window *int) ProviderModel {
	return ProviderModel{
		ProfileKey: profileKey, ModelID: modelID, DisplayName: "Model " + profileKey,
		ContextWindowTokens: window, MaxOutputTokens: 2048, State: ProviderEnabled,
	}
}

func intPtr(n int) *int       { return &n }
func int64Ptr(n int64) *int64 { return &n }
func strPtr(s string) *string { return &s }
func f64Ptr(f float64) *float64 {
	return &f
}

func TestProviderCatalogCredentialStatesAndRevisions(t *testing.T) {
	store := resetCatalogFixtures(t)
	ctx := context.Background()
	const admin = int64(7)
	base := SaveProvider{
		ProviderID: "acme", DisplayName: "Acme", Protocol: ProtocolOpenAIChat,
		BaseURL: "https://chat.example/v1", State: ProviderDisabled,
		Models: []ProviderModel{catalogModel("m", "m", intPtr(32768))},
	}

	// Draft without a credential; enabling it is refused.
	revision, err := store.SaveProviderConfig(ctx, admin, base)
	if err != nil || revision != 1 {
		t.Fatalf("draft save revision=%d err=%v", revision, err)
	}
	enabled := base
	enabled.State = ProviderEnabled
	if _, err := store.SaveProviderConfig(ctx, admin, enabled); !errors.Is(err, ErrInvalid) {
		t.Fatalf("enabling a credential-less draft err=%v", err)
	}
	configs, err := store.ListProviderConfigs(ctx, admin)
	if err != nil || len(configs) != 1 || configs[0].CredentialConfigured || configs[0].Revision != 1 {
		t.Fatalf("draft list %+v err=%v", configs, err)
	}

	// Set: the plaintext never reaches the row, only an enc2 envelope does.
	withKey := enabled
	withKey.Credential = "plain-api-key-1"
	withKey.ExpectedRevision = int64Ptr(1)
	if revision, err = store.SaveProviderConfig(ctx, admin, withKey); err != nil || revision != 2 {
		t.Fatalf("set credential revision=%d err=%v", revision, err)
	}
	var stored string
	if err := superPool(t, ctx).QueryRow(ctx,
		`SELECT credential_cipher FROM vc.provider_config WHERE provider_id = 'acme'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored, "enc2:") || strings.Contains(stored, "plain-api-key") {
		t.Fatalf("credential stored without field encryption: %q", stored)
	}
	if plain, err := store.GetProviderCredential(ctx, admin, "acme"); err != nil || plain != "plain-api-key-1" {
		t.Fatalf("round trip plain=%q err=%v", plain, err)
	}

	// Stale expected revision is refused with the current value.
	stale := enabled
	stale.ExpectedRevision = int64Ptr(1)
	var conflict *RevisionConflictError
	if _, err := store.SaveProviderConfig(ctx, admin, stale); !errors.As(err, &conflict) || conflict.Current != 2 {
		t.Fatalf("stale save err=%v", err)
	}

	// Keep: an older caller that sends no credential leaves the key in place.
	keep := enabled
	keep.DisplayName = "Acme renamed"
	if revision, err = store.SaveProviderConfig(ctx, admin, keep); err != nil || revision != 3 {
		t.Fatalf("keep revision=%d err=%v", revision, err)
	}
	if plain, err := store.GetProviderCredential(ctx, admin, "acme"); err != nil || plain != "plain-api-key-1" {
		t.Fatalf("keep must preserve plain=%q err=%v", plain, err)
	}

	// Clear is explicit and only valid for a disabled provider.
	clear := base
	clear.ClearCredential = true
	clear.State = ProviderEnabled
	if _, err := store.SaveProviderConfig(ctx, admin, clear); !errors.Is(err, ErrInvalid) {
		t.Fatalf("clear while enabled err=%v", err)
	}
	clear.State = ProviderDisabled
	if revision, err = store.SaveProviderConfig(ctx, admin, clear); err != nil || revision != 4 {
		t.Fatalf("clear revision=%d err=%v", revision, err)
	}
	if _, err := store.GetProviderCredential(ctx, admin, "acme"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cleared credential must not be usable err=%v", err)
	}
	configs, _ = store.ListProviderConfigs(ctx, admin)
	if configs[0].CredentialConfigured || configs[0].Revision != 4 {
		t.Fatalf("cleared list %+v", configs[0])
	}
}

func TestProviderCatalogConcurrentSaveLosesOnlyOneWriter(t *testing.T) {
	store := resetCatalogFixtures(t)
	ctx := context.Background()
	const admin = int64(7)
	base := SaveProvider{
		ProviderID: "race", DisplayName: "Race", Protocol: ProtocolAnthropic,
		BaseURL: "https://anthropic.example/v1", State: ProviderDisabled,
		Models: []ProviderModel{catalogModel("m", "m", intPtr(8192))},
	}
	if _, err := store.SaveProviderConfig(ctx, admin, base); err != nil {
		t.Fatal(err)
	}

	type outcome struct {
		name string
		err  error
	}
	results := make(chan outcome, 2)
	var wg sync.WaitGroup
	for _, name := range []string{"writer-a", "writer-b"} {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			in := base
			in.DisplayName = name
			in.ExpectedRevision = int64Ptr(1)
			_, err := store.SaveProviderConfig(ctx, admin, in)
			results <- outcome{name: name, err: err}
		}(name)
	}
	wg.Wait()
	close(results)
	var winner string
	losers := 0
	for r := range results {
		var conflict *RevisionConflictError
		switch {
		case r.err == nil:
			winner = r.name
		case errors.As(r.err, &conflict) && conflict.Current == 2:
			losers++
		default:
			t.Fatalf("%s unexpected err=%v", r.name, r.err)
		}
	}
	if winner == "" || losers != 1 {
		t.Fatalf("winner=%q losers=%d", winner, losers)
	}
	configs, err := store.ListProviderConfigs(ctx, admin)
	if err != nil || configs[0].DisplayName != winner || configs[0].Revision != 2 {
		t.Fatalf("persisted %+v err=%v", configs, err)
	}
}

func TestProviderCatalogProfilesDocumentsAndLegacyKeep(t *testing.T) {
	store := resetCatalogFixtures(t)
	ctx := context.Background()
	const admin = int64(7)
	rich := catalogModel("m@memory", "m", intPtr(32768))
	rich.Capabilities = ModelCapabilities{"toolCalls": CapabilityDeclared, "pdfInput": CapabilityUnsupported}
	rich.ReasoningLevels = []string{"low", "high"}
	rich.GenerationParams = &GenerationParams{Temperature: f64Ptr(0.2), ReasoningEffort: strPtr("low")}
	rich.Pricing = &ModelPricing{Currency: strPtr("USD"), InputPerMillionTokens: f64Ptr(1.5)}
	in := SaveProvider{
		ProviderID: "acme", DisplayName: "Acme", Protocol: ProtocolOpenAIResponses,
		BaseURL: "https://gateway.example/v1", Credential: "k", State: ProviderEnabled,
		Models: []ProviderModel{catalogModel("m", "m", intPtr(32768)), rich},
	}
	if _, err := store.SaveProviderConfig(ctx, admin, in); err != nil {
		t.Fatal(err)
	}
	configs, err := store.ListProviderConfigs(ctx, admin)
	if err != nil || len(configs[0].Models) != 2 {
		t.Fatalf("profiles %+v err=%v", configs, err)
	}
	var memory ProviderModel
	for _, m := range configs[0].Models {
		if m.ProfileKey == "m@memory" {
			memory = m
		}
	}
	if memory.ModelID != "m" || memory.Capabilities["toolCalls"] != CapabilityDeclared ||
		memory.Capabilities["pdfInput"] != CapabilityUnsupported || memory.Capabilities["imageInput"] != CapabilityUnknown ||
		len(memory.ReasoningLevels) != 2 || *memory.GenerationParams.Temperature != 0.2 ||
		*memory.GenerationParams.ReasoningEffort != "low" || memory.GenerationParams.TopP != nil ||
		*memory.Pricing.Currency != "USD" || memory.Pricing.OutputPerMillionTokens != nil {
		t.Fatalf("round trip %+v", memory)
	}

	// Refusals are explicit: VERIFIED is not an administrator input, an effort
	// outside the declared levels and a price without currency are rejected.
	for name, mutate := range map[string]func(*ProviderModel){
		"verified":       func(m *ProviderModel) { m.Capabilities = ModelCapabilities{"toolCalls": CapabilityVerified} },
		"unknown effort": func(m *ProviderModel) { m.GenerationParams = &GenerationParams{ReasoningEffort: strPtr("medium")} },
		"no currency":    func(m *ProviderModel) { m.Pricing = &ModelPricing{OutputPerMillionTokens: f64Ptr(3)} },
		"effort vs stored levels": func(m *ProviderModel) {
			m.ReasoningLevels = nil
			m.GenerationParams = &GenerationParams{ReasoningEffort: strPtr("medium")}
		},
	} {
		bad := in
		model := rich
		mutate(&model)
		bad.Models = []ProviderModel{catalogModel("m", "m", intPtr(32768)), model}
		if _, err := store.SaveProviderConfig(ctx, admin, bad); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%s: err=%v", name, err)
		}
	}

	// A legacy caller re-saves the same profiles without documents: nothing is lost.
	legacy := in
	legacy.Credential = ""
	legacy.Models = []ProviderModel{catalogModel("m", "m", intPtr(32768)), catalogModel("m@memory", "m", intPtr(32768))}
	if _, err := store.SaveProviderConfig(ctx, admin, legacy); err != nil {
		t.Fatal(err)
	}
	configs, _ = store.ListProviderConfigs(ctx, admin)
	for _, m := range configs[0].Models {
		if m.ProfileKey == "m@memory" && (m.Capabilities["toolCalls"] != CapabilityDeclared ||
			*m.GenerationParams.Temperature != 0.2 || *m.Pricing.Currency != "USD") {
			t.Fatalf("legacy save dropped documents %+v", m)
		}
	}

	// A field the verification action already marked VERIFIED may be echoed
	// back while another capability changes; cloning or creating with VERIFIED
	// is still refused.
	if _, err := superPool(t, ctx).Exec(ctx, `UPDATE vc.provider_model
		SET capabilities = capabilities || '{"toolCalls":"VERIFIED"}'::jsonb
		WHERE provider_id = 'acme' AND profile_key = 'm@memory'`); err != nil {
		t.Fatal(err)
	}
	echo := rich
	echo.Capabilities = ModelCapabilities{"toolCalls": CapabilityVerified, "pdfInput": CapabilityDeclared}
	edit := legacy
	edit.Models = []ProviderModel{catalogModel("m", "m", intPtr(32768)), echo}
	if _, err := store.SaveProviderConfig(ctx, admin, edit); err != nil {
		t.Fatalf("echoing a verified field err=%v", err)
	}
	configs, _ = store.ListProviderConfigs(ctx, admin)
	for _, m := range configs[0].Models {
		if m.ProfileKey == "m@memory" && (m.Capabilities["toolCalls"] != CapabilityVerified || m.Capabilities["pdfInput"] != CapabilityDeclared) {
			t.Fatalf("verified field not retained %+v", m.Capabilities)
		}
	}
	clone := echo
	clone.ProfileKey = "m@clone"
	cloned := edit
	cloned.Models = append([]ProviderModel{}, edit.Models...)
	cloned.Models = append(cloned.Models, clone)
	if _, err := store.SaveProviderConfig(ctx, admin, cloned); !errors.Is(err, ErrInvalid) {
		t.Fatalf("clone must not inherit VERIFIED err=%v", err)
	}

	// The legacy route chain sees the remote model once, not once per profile.
	routes, err := store.ResolveProviderRoutes(ctx)
	if err != nil || len(routes) != 1 || routes[0].ModelID != "m" || routes[0].Credential != "k" {
		t.Fatalf("legacy routes %+v err=%v", routes, err)
	}
}

func TestPurposeBindingsAndServiceResolution(t *testing.T) {
	store := resetCatalogFixtures(t)
	ctx := context.Background()
	const admin = int64(7)
	in := SaveProvider{
		ProviderID: "acme", DisplayName: "Acme", Protocol: ProtocolOpenAIChat,
		BaseURL: "https://chat.example/v1", Credential: "secret-2", State: ProviderEnabled,
		Models: []ProviderModel{
			catalogModel("m", "m", intPtr(32768)),
			catalogModel("m@memory", "m", intPtr(32768)),
			catalogModel("nowindow", "n", nil),
		},
	}
	if _, err := store.SaveProviderConfig(ctx, admin, in); err != nil {
		t.Fatal(err)
	}

	bindings, err := store.ListPurposeBindings(ctx, admin)
	if err != nil || len(bindings) != 6 {
		t.Fatalf("bindings %+v err=%v", bindings, err)
	}
	for _, b := range bindings {
		if b.Status != BindingPending || b.Revision != 1 || b.ProviderID != "" {
			t.Fatalf("seed binding %+v", b)
		}
	}

	// Embedding cannot pin a chat-protocol profile; it stays pending.
	_, err = store.SavePurposeBinding(ctx, admin, SavePurposeBinding{
		Purpose: PurposeEmbedding, ProviderID: "acme", ProfileKey: "m", State: ProviderEnabled})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("embedding pin err=%v", err)
	}
	// A missing profile is an invalid reference, not a routable binding.
	_, err = store.SavePurposeBinding(ctx, admin, SavePurposeBinding{
		Purpose: PurposeNPCDialogue, ProviderID: "acme", ProfileKey: "missing", State: ProviderEnabled})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("missing profile err=%v", err)
	}

	foreground, err := store.SavePurposeBinding(ctx, admin, SavePurposeBinding{
		Purpose: PurposeForegroundChat, ProviderID: "acme", ProfileKey: "m@memory",
		State: ProviderEnabled, ExpectedRevision: int64Ptr(1)})
	if err != nil || foreground.Status != BindingReady || foreground.Revision != 2 || foreground.ModelID != "m" {
		t.Fatalf("foreground %+v err=%v", foreground, err)
	}
	var conflict *RevisionConflictError
	_, err = store.SavePurposeBinding(ctx, admin, SavePurposeBinding{
		Purpose: PurposeForegroundChat, ProviderID: "acme", ProfileKey: "m",
		State: ProviderEnabled, ExpectedRevision: int64Ptr(1)})
	if !errors.As(err, &conflict) || conflict.Current != 2 {
		t.Fatalf("stale binding err=%v", err)
	}
	// A chat purpose on a profile without a context window is not ready.
	npc, err := store.SavePurposeBinding(ctx, admin, SavePurposeBinding{
		Purpose: PurposeNPCDialogue, ProviderID: "acme", ProfileKey: "nowindow", State: ProviderEnabled})
	if err != nil || npc.Status != BindingUnavailable {
		t.Fatalf("npc without window %+v err=%v", npc, err)
	}
	npc, err = store.SavePurposeBinding(ctx, admin, SavePurposeBinding{
		Purpose: PurposeNPCDialogue, ProviderID: "acme", ProfileKey: "m", State: ProviderEnabled})
	if err != nil || npc.Status != BindingReady || npc.Revision != 3 {
		t.Fatalf("npc %+v err=%v", npc, err)
	}

	// Dropping a pinned profile from the snapshot is refused and names the purposes.
	drop := in
	drop.Credential = ""
	drop.Models = []ProviderModel{catalogModel("m", "m", intPtr(32768))}
	var inUse *ProfileInUseError
	if _, err := store.SaveProviderConfig(ctx, admin, drop); !errors.As(err, &inUse) || strings.Join(inUse.Purposes, ",") != "FOREGROUND_CHAT" {
		t.Fatalf("drop pinned profile err=%v", err)
	}
	configs, _ := store.ListProviderConfigs(ctx, admin)
	for _, m := range configs[0].Models {
		if m.ProfileKey == "m@memory" && strings.Join(m.BoundPurposes, ",") != "FOREGROUND_CHAT" {
			t.Fatalf("bound purposes %+v", m)
		}
	}

	// Service resolution for an ACTIVE owner returns the live key once.
	resolved, err := store.ResolvePurpose(ctx, ResolvePurpose{OwnerAccountID: 1, Purpose: PurposeForegroundChat,
		ProviderID: "acme", ProfileKey: "m@memory", ProviderRevision: int64Ptr(1), BindingRevision: int64Ptr(2)})
	if err != nil || resolved.Credential != "secret-2" || resolved.Model.ProfileKey != "m@memory" ||
		resolved.Model.ModelID != "m" || resolved.ProviderRevision != 1 || *resolved.Model.ContextWindowTokens != 32768 {
		t.Fatalf("resolve %+v err=%v", resolved, err)
	}
	var stale *ResolveConflictError
	_, err = store.ResolvePurpose(ctx, ResolvePurpose{OwnerAccountID: 1, Purpose: PurposeForegroundChat, ProfileKey: "m"})
	if !errors.As(err, &stale) || stale.ProfileKey != "m@memory" || stale.BindingRevision != 2 {
		t.Fatalf("stale projection err=%v", err)
	}
	if _, err := store.ResolvePurpose(ctx, ResolvePurpose{OwnerAccountID: 2, Purpose: PurposeForegroundChat}); !errors.Is(err, ErrServiceOwnerRejected) {
		t.Fatalf("disabled owner err=%v", err)
	}
	var unavailable *PurposeUnavailableError
	if _, err := store.ResolvePurpose(ctx, ResolvePurpose{OwnerAccountID: 1, Purpose: PurposeStoryDirector}); !errors.As(err, &unavailable) || unavailable.Status != BindingPending {
		t.Fatalf("pending purpose err=%v", err)
	}

	// Switching the foreground binding leaves the independently pinned NPC purpose alone.
	if _, err := store.SavePurposeBinding(ctx, admin, SavePurposeBinding{
		Purpose: PurposeForegroundChat, ProviderID: "acme", ProfileKey: "m", State: ProviderDisabled}); err != nil {
		t.Fatal(err)
	}
	bindings, _ = store.ListPurposeBindings(ctx, admin)
	for _, b := range bindings {
		switch b.Purpose {
		case PurposeNPCDialogue:
			if b.ProfileKey != "m" || b.Revision != 3 || b.Status != BindingReady {
				t.Fatalf("npc drifted %+v", b)
			}
		case PurposeForegroundChat:
			if b.Status != BindingDisabled || b.Revision != 3 {
				t.Fatalf("foreground %+v", b)
			}
		}
	}
	if _, err := store.ResolvePurpose(ctx, ResolvePurpose{OwnerAccountID: 1, Purpose: PurposeForegroundChat}); !errors.As(err, &unavailable) || unavailable.Status != BindingDisabled {
		t.Fatalf("disabled binding err=%v", err)
	}

	// Clearing the key (provider disabled) revokes the still-enabled NPC purpose immediately.
	cleared := in
	cleared.Credential = ""
	cleared.ClearCredential = true
	cleared.State = ProviderDisabled
	if _, err := store.SaveProviderConfig(ctx, admin, cleared); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolvePurpose(ctx, ResolvePurpose{OwnerAccountID: 1, Purpose: PurposeNPCDialogue}); !errors.As(err, &unavailable) || unavailable.Status != BindingUnavailable {
		t.Fatalf("revoked key err=%v", err)
	}
}
