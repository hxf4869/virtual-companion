//go:build !unix

package observability

func processCPUSeconds() float64 {
	return 0
}
