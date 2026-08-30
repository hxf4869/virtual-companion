package modelhttp

import (
	"errors"
	"io"
)

var (
	ErrOverLimit = errors.New("provider response exceeded the configured limit")
	ErrMalformed = errors.New("provider payload failed validation")
)

// BoundReader consumes at most max bytes plus one overflow probe.
type BoundReader struct {
	r    io.Reader
	left int64
	hit  bool
}

func NewBoundReader(r io.Reader, max int64) *BoundReader {
	if max < 0 {
		max = 0
	}
	return &BoundReader{r: r, left: max}
}

func (b *BoundReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.hit {
		return 0, ErrOverLimit
	}
	if b.left == 0 {
		var probe [1]byte
		n, err := b.r.Read(probe[:])
		if n > 0 {
			b.hit = true
			return 0, ErrOverLimit
		}
		if err == nil {
			err = io.EOF
		}
		return 0, err
	}
	if int64(len(p)) > b.left {
		p = p[:b.left]
	}
	n, err := b.r.Read(p)
	if n > 0 {
		b.left -= int64(n)
	}
	return n, err
}
