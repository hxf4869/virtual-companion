package postgres

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestLoadEngineRecallPartsCompletes(t *testing.T) {
	candidates, embedding, rerankOn, err := loadEngineRecallParts(context.Background(),
		func(context.Context) (map[string]Memory, error) {
			return map[string]Memory{"a": {Summary: "a"}}, nil
		},
		func(context.Context) (EmbeddingConfig, error) {
			return EmbeddingConfig{Model: "embed"}, nil
		},
		func(context.Context) (bool, error) {
			return true, nil
		},
	)
	if err != nil || len(candidates) != 1 || candidates["a"].Summary != "a" || embedding.Model != "embed" || !rerankOn {
		t.Fatalf("parts %+v %+v %v err=%v", candidates, embedding, rerankOn, err)
	}
}

func TestLoadEngineRecallPartsPrefersRealError(t *testing.T) {
	boom := errors.New("candidate failed")
	_, _, _, err := loadEngineRecallParts(context.Background(),
		func(context.Context) (map[string]Memory, error) {
			return nil, boom
		},
		func(ctx context.Context) (EmbeddingConfig, error) {
			<-ctx.Done()
			return EmbeddingConfig{}, ctx.Err()
		},
		func(ctx context.Context) (bool, error) {
			<-ctx.Done()
			return false, ctx.Err()
		},
	)
	if !errors.Is(err, boom) {
		t.Fatalf("err=%v", err)
	}
}

func TestRunEngineRecallLoadIgnoresConfigMissWhenNothingToSearch(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	load, err := runEngineRecallLoad(ctx, recallQuery{Text: "今天只是问一句公开的话", Limit: 20},
		func(context.Context) (map[string]Memory, error) {
			return map[string]Memory{}, nil
		},
		func(ctx context.Context) (EmbeddingConfig, error) {
			<-ctx.Done()
			return EmbeddingConfig{}, ErrNotFound
		},
		func(ctx context.Context) (bool, error) {
			<-ctx.Done()
			return false, errors.New("rerank down")
		},
	)
	if err != nil || load.search || !load.found.GateKnown || len(load.found.Memories) != 0 {
		t.Fatalf("empty allowlist must not fail recall: search=%v gate=%v err=%v", load.search, load.found.GateKnown, err)
	}
}

func TestRunEngineRecallLoadKeepsCandidatesWhenEmbeddingMissesFirst(t *testing.T) {
	load, err := runEngineRecallLoad(context.Background(), recallQuery{Text: "今天只是问一句公开的话", Limit: 20},
		func(ctx context.Context) (map[string]Memory, error) {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(40 * time.Millisecond):
				return map[string]Memory{}, nil
			}
		},
		func(context.Context) (EmbeddingConfig, error) {
			return EmbeddingConfig{}, ErrNotFound
		},
		func(context.Context) (bool, error) { return true, nil },
	)
	if err != nil || load.search || !load.found.GateKnown {
		t.Fatalf("canceled candidates hid an empty allowlist: search=%v gate=%v err=%v", load.search, load.found.GateKnown, err)
	}
}

func TestRunEngineRecallLoadReturnsCandidateError(t *testing.T) {
	boom := errors.New("candidate failed")
	_, err := runEngineRecallLoad(context.Background(), recallQuery{Text: "hello", Limit: 20},
		func(context.Context) (map[string]Memory, error) {
			return nil, boom
		},
		func(ctx context.Context) (EmbeddingConfig, error) {
			<-ctx.Done()
			return EmbeddingConfig{}, ctx.Err()
		},
		func(ctx context.Context) (bool, error) {
			<-ctx.Done()
			return false, ctx.Err()
		},
	)
	if !errors.Is(err, boom) {
		t.Fatalf("err=%v", err)
	}
}

func TestRunEngineRecallLoadSurfacesEmbeddingMissWhenSearchNeeded(t *testing.T) {
	_, err := runEngineRecallLoad(context.Background(), recallQuery{Text: "hello", Limit: 20},
		func(context.Context) (map[string]Memory, error) {
			return map[string]Memory{"m1": {Summary: "fact"}}, nil
		},
		func(context.Context) (EmbeddingConfig, error) {
			return EmbeddingConfig{}, ErrNotFound
		},
		func(context.Context) (bool, error) { return true, nil },
	)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err=%v", err)
	}
}

func TestLoadSTRecallPartsAndProfileError(t *testing.T) {
	source, profile, queryErr, profileErr := loadSTRecallParts(
		func() (stDigestSource, error) { return stDigestSource{text: "hello"}, nil },
		func() (*memoryProfile, error) { return &memoryProfile{}, nil },
	)
	if queryErr != nil || profileErr != nil || source.text != "hello" || profile == nil {
		t.Fatalf("parts %+v %+v %v %v", source, profile, queryErr, profileErr)
	}
	profileFailure := errors.New("profile failed")
	skipped, err := stRecallLoadError(stDigestSource{}, nil, profileFailure)
	if skipped || !errors.Is(err, profileFailure) {
		t.Fatalf("empty query skipped=%v err=%v", skipped, err)
	}
	skipped, err = stRecallLoadError(stDigestSource{}, nil, nil)
	if !skipped || err != nil {
		t.Fatalf("empty query without profile error skipped=%v err=%v", skipped, err)
	}
	queryFailure := errors.New("query failed")
	skipped, err = stRecallLoadError(stDigestSource{text: "kept"}, queryFailure, profileFailure)
	if skipped || !errors.Is(err, queryFailure) {
		t.Fatalf("query error skipped=%v err=%v", skipped, err)
	}
}

func TestMapRaiseSharesBudgetReason(t *testing.T) {
	for _, msg := range []string{
		"model usage limits are not configured",
		"model usage ceiling is too small",
		"model cost limits are not configured",
		"model cost reservation ceiling is too small",
	} {
		err := mapRaise(msg)
		var usage *ModelUsageError
		if !errors.As(err, &usage) || usage.Reason != ModelUsageNoBudget {
			t.Fatalf("%s -> %v", msg, err)
		}
	}
	if !errors.Is(mapRaise("tool call verification identity changed"), ErrToolVerificationStale) {
		t.Fatal("identity mismatch was not stale")
	}
}
