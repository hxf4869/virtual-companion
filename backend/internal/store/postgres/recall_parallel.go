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

// engineRecallLoad is the parallel prelude to a MemoryCore search.
// Search is false when the allowlist has nothing to inject; embedding and
// rerank errors are then irrelevant and must not fail the recall.
type engineRecallLoad struct {
	found     engineRecall
	allowed   map[string]Memory
	ids       []string
	embedding EmbeddingConfig
	rerankOn  bool
	search    bool
}

// runEngineRecallLoad starts candidate, embedding and rerank reads together.
// Embedding and rerank each have their own cancel scope. When the allowlist
// needs no search, their errors are ignored and those reads are canceled.
// A candidate failure still cancels the other two and is returned as-is.
func runEngineRecallLoad(
	ctx context.Context,
	q recallQuery,
	candidatesFn func(context.Context) (map[string]Memory, error),
	embeddingFn func(context.Context) (EmbeddingConfig, error),
	rerankFn func(context.Context) (bool, error),
) (engineRecallLoad, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	candCtx, candCancel := context.WithCancel(ctx)
	embCtx, embCancel := context.WithCancel(ctx)
	rerankCtx, rerankCancel := context.WithCancel(ctx)
	defer candCancel()
	defer embCancel()
	defer rerankCancel()
	type candOut struct {
		items map[string]Memory
		err   error
	}
	type embOut struct {
		cfg EmbeddingConfig
		err error
	}
	type rerankOut struct {
		on  bool
		err error
	}
	candCh := make(chan candOut, 1)
	embCh := make(chan embOut, 1)
	rerankCh := make(chan rerankOut, 1)
	go func() {
		items, err := candidatesFn(candCtx)
		candCh <- candOut{items, err}
	}()
	go func() {
		cfg, err := embeddingFn(embCtx)
		embCh <- embOut{cfg, err}
	}()
	go func() {
		on, err := rerankFn(rerankCtx)
		rerankCh <- rerankOut{on, err}
	}()
	cand := <-candCh
	if cand.err != nil {
		embCancel()
		rerankCancel()
		return engineRecallLoad{}, cand.err
	}
	found, allowed, ids, search := splitEngineCandidates(cand.items, q)
	if !search {
		embCancel()
		rerankCancel()
		return engineRecallLoad{found: found}, nil
	}
	emb := <-embCh
	rerank := <-rerankCh
	if emb.err != nil {
		return engineRecallLoad{}, emb.err
	}
	if rerank.err != nil {
		return engineRecallLoad{}, rerank.err
	}
	return engineRecallLoad{
		found: found, allowed: allowed, ids: ids,
		embedding: emb.cfg, rerankOn: rerank.on, search: true,
	}, nil
}

func splitEngineCandidates(candidates map[string]Memory, q recallQuery) (engineRecall, map[string]Memory, []string, bool) {
	ids := []string{}
	undated, otherDay := []string{}, []string{}
	allowed := map[string]Memory{}
	for id, m := range candidates {
		if q.Date != nil && (m.Time == nil || m.Time.EventDate == nil) {
			undated = append(undated, id)
			continue
		}
		if q.Date != nil && *m.Time.EventDate != *q.Date {
			otherDay = append(otherDay, id)
			continue
		}
		allowed[id] = m
		ids = append(ids, id)
	}
	found := engineRecall{Memories: []Memory{}, DateIDs: append([]string{}, ids...), UndatedIDs: undated, OtherDayIDs: otherDay}
	search := len(ids) != 0 || (len(q.GateTexts) > 0 && queryHasUndatedTopic(q.Text))
	if !search {
		found.GateKnown = true
	}
	return found, allowed, ids, search
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
