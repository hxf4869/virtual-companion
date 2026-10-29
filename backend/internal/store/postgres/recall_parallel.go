package postgres

import (
	"context"
	"errors"
	"sync"
)

// loadEngineRecallParts runs the three independent recall reads. The first
// real error cancels the rest; a canceled sibling does not hide it.
func loadEngineRecallParts(
	ctx context.Context,
	candidatesFn func(context.Context) (map[string]Memory, error),
	embeddingFn func(context.Context) (EmbeddingConfig, error),
	rerankFn func(context.Context) (bool, error),
) (map[string]Memory, EmbeddingConfig, bool, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var candidates map[string]Memory
	var embedding EmbeddingConfig
	var rerankOn bool
	errc := make(chan error, 3)
	go func() {
		var err error
		candidates, err = candidatesFn(ctx)
		errc <- err
	}()
	go func() {
		var err error
		embedding, err = embeddingFn(ctx)
		errc <- err
	}()
	go func() {
		var err error
		rerankOn, err = rerankFn(ctx)
		errc <- err
	}()
	var first error
	for range 3 {
		err := <-errc
		if err == nil {
			continue
		}
		if first == nil || (errors.Is(first, context.Canceled) && !errors.Is(err, context.Canceled)) {
			first = err
		}
		cancel()
	}
	if first != nil {
		return nil, EmbeddingConfig{}, false, first
	}
	return candidates, embedding, rerankOn, nil
}

func loadSTRecallParts(
	query func() (stDigestSource, error),
	profile func() (*memoryProfile, error),
) (stDigestSource, *memoryProfile, error, error) {
	var querySource stDigestSource
	var loaded *memoryProfile
	var queryErr, profileErr error
	var ready sync.WaitGroup
	ready.Add(2)
	go func() {
		defer ready.Done()
		querySource, queryErr = query()
	}()
	go func() {
		defer ready.Done()
		loaded, profileErr = profile()
	}()
	ready.Wait()
	return querySource, loaded, queryErr, profileErr
}

// stRecallLoadError reports a profile failure before treating an empty query
// as a skip. A query failure still wins when both reads fail.
func stRecallLoadError(query stDigestSource, queryErr, profileErr error) (skipped bool, err error) {
	if queryErr != nil {
		return false, queryErr
	}
	if profileErr != nil {
		return false, profileErr
	}
	if query.text == "" {
		return true, nil
	}
	return false, nil
}
