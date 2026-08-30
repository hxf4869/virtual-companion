package contracttest

import (
	"context"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

// FakeProvider and FailureProvider are contract-test fixtures, not production modules.

type FakeProvider struct {
	Deltas []string
	Result companion.AttemptResult
}

func (f FakeProvider) Stream(ctx context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	if emit == nil {
		emit = func(companion.OutputDelta) error { return nil }
	}
	for _, d := range f.Deltas {
		if err := ctx.Err(); err != nil {
			return companion.AttemptResult{}, companion.Canceled(companion.DeliveryNotSent)
		}
		if err := emit(companion.OutputDelta{Text: d}); err != nil {
			if companion.AsError(err) != nil {
				return companion.AttemptResult{}, err
			}
			return companion.AttemptResult{}, companion.Disconnected(companion.DeliveryUnknown)
		}
	}
	return f.Result, nil
}

type FailureProvider struct {
	Deltas []string
	Err    error
}

func (f FailureProvider) Stream(ctx context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	if emit == nil {
		emit = func(companion.OutputDelta) error { return nil }
	}
	for _, d := range f.Deltas {
		if err := ctx.Err(); err != nil {
			return companion.AttemptResult{}, companion.Canceled(companion.DeliveryNotSent)
		}
		_ = emit(companion.OutputDelta{Text: d})
	}
	if f.Err == nil {
		return companion.AttemptResult{}, companion.Disconnected(companion.DeliveryUnknown)
	}
	return companion.AttemptResult{}, f.Err
}

var (
	_ companion.Provider = FakeProvider{}
	_ companion.Provider = FailureProvider{}
)

func TestFakeProviderStreamsThenReturnsResult(t *testing.T) {
	t.Parallel()
	fake := FakeProvider{
		Deltas: []string{"你", "好"},
		Result: companion.AttemptResult{
			Finish: companion.FinishStop,
			Usage:  companion.Usage{InputTokens: 1, OutputTokens: 2, TotalTokens: 3},
		},
	}
	var got []string
	res, err := fake.Stream(context.Background(), companion.ModelRequest{}, func(d companion.OutputDelta) error {
		got = append(got, d.Text)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if stringsJoin(got) != "你好" || res.Finish != companion.FinishStop || res.Usage.TotalTokens != 3 {
		t.Fatalf("got %v %+v", got, res)
	}
}

func TestFailureProviderReturnsTypedErrorAndZeroResult(t *testing.T) {
	t.Parallel()
	fail := FailureProvider{Err: companion.RateLimited()}
	res, err := fail.Stream(context.Background(), companion.ModelRequest{}, nil)
	if res != (companion.AttemptResult{}) {
		t.Fatalf("result must be zero, got %+v", res)
	}
	requireCode(t, err, companion.CodeRateLimited)
}

func stringsJoin(in []string) string {
	out := ""
	for _, s := range in {
		out += s
	}
	return out
}
