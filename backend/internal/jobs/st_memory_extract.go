package jobs

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type stExtractStore interface {
	ReadSTMemoryExtractInput(context.Context, int64, int64, int64) (postgres.MemoryExtractInput, error)
	PrepareSTMemoryExtractAttempt(context.Context, int64, int64, int64, string, string, string, string, string, int) (postgres.MemoryExtractPreparation, error)
	ResolvePurpose(context.Context, postgres.ResolvePurpose) (postgres.ResolvedPurpose, error)
}

// ST extraction uses its dedicated purpose binding. Missing configuration is
// an explicit failure; it never falls back to the foreground/global provider.
func (l *Loop) extractSTProvider(ctx context.Context, owner int64) (companion.Provider, func(), extractProviderIdentity, string) {
	store, ok := l.store.(stExtractStore)
	if !ok || l.providerFactory == nil {
		return nil, nil, extractProviderIdentity{}, "ST_EXTRACTION_UNAVAILABLE"
	}
	purpose, err := store.ResolvePurpose(ctx, postgres.ResolvePurpose{OwnerAccountID: owner, Purpose: "MEMORY_EXTRACTION_DEDUP_SUMMARY"})
	if err != nil {
		return nil, nil, extractProviderIdentity{}, "EXTRACTION_PURPOSE_UNAVAILABLE"
	}
	// W09 supplies the full background parameter mapper. Until then, reject a
	// pinned parameter the existing Go adapters cannot honor; do not drop it.
	params := purpose.Model.GenerationParams
	if params != nil && (params.Temperature != nil || params.TopP != nil || params.ReasoningEffort != nil) {
		return nil, nil, extractProviderIdentity{}, "EXTRACTION_PARAMETERS_UNSUPPORTED"
	}
	identity := extractProviderIdentity{providerID: purpose.ProviderID, supplierName: purpose.ProviderName, modelID: purpose.Model.ModelID}
	p, err := l.providerFactory(modelprovider.Route{ProviderID: purpose.ProviderID, SupplierName: purpose.ProviderName,
		Protocol: purpose.Protocol, BaseURL: purpose.BaseURL, Credential: purpose.Credential, ModelID: purpose.Model.ModelID,
		MaxOutputTokens: min(extractMaxTokens, purpose.Model.MaxOutputTokens)})
	if err != nil {
		return nil, nil, identity, "EXTRACTION_PURPOSE_INVALID"
	}
	return p, func() {
		if closer, ok := p.(interface{ Close() }); ok {
			closer.Close()
		}
	}, identity, ""
}
