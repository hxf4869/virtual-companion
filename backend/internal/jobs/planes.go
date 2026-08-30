package jobs

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/config"
)

// namedPlane lets a passive capability satisfy app.Plane without a second loop.
type namedPlane struct {
	name config.Plane
}

func (p namedPlane) Name() config.Plane           { return p.name }
func (p namedPlane) Start(context.Context) error { return nil }
func (p namedPlane) Stop(context.Context) error  { return nil }

func ProviderPlane() namedPlane {
	return namedPlane{name: config.PlaneProvider}
}

func RealtimePlane() namedPlane {
	return namedPlane{name: config.PlaneRealtime}
}

func GenerationWorkerPlane() namedPlane {
	return namedPlane{name: config.PlaneGenerationWorker}
}
