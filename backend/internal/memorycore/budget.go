package memorycore

import (
	"time"

	"github.com/hxf4869/virtual-companion/internal/provider"
)

const (
	// ExtractFirstToken is the adapter hard maximum. Reasoning effort max can
	// spend that long before the first token; the chat default of one minute
	// cancelled those calls.
	ExtractFirstToken = 5 * time.Minute
	// ExtractTotal stays inside the six-minute extract lease, with room to
	// emit after the first token. The adapter allows up to ten minutes, but
	// a longer call would lose its claim before publication.
	ExtractTotal = 5*time.Minute + 30*time.Second
	// ExtractOpen is one model call. Broker.Open rejects anything past ten
	// minutes, and the lease is six.
	ExtractOpen = ExtractTotal
	// ExtractJob covers that call plus publication. A profile rebuild that
	// does not fit is retried on its own once the operation is published.
	ExtractJob = 5*time.Minute + 45*time.Second
)

// ExtractionFactory keeps the chat connect budget and raises only the memory
// call windows. Adapters refuse to lengthen a request past these values.
func ExtractionFactory(base provider.Factory) provider.Factory {
	base.FirstTokenTimeout = ExtractFirstToken
	base.TotalTimeout = ExtractTotal
	return base
}
