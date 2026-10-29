// Package restoregate is the local marker that keeps a restored companiond
// from claiming work or serving memory retrieval until restore.sh finishes
// cleanup. The path comes from VC_RESTORE_GATE_FILE at process start. Each
// check reads the file again, so deleting the marker opens the gate without
// a restart. A missing path or a missing file means there is no restore in
// progress. blocked:true, invalid JSON, and unreadable files stay closed.
package restoregate

import (
	"encoding/json"
	"os"
	"strings"
)

// Closed reports whether jobs and retrieval must stay shut.
func Closed(path string) bool {
	path = strings.TrimSpace(path)
	if path == "" {
		return false
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return !os.IsNotExist(err)
	}
	var marker struct {
		Blocked *bool `json:"blocked"`
	}
	if json.Unmarshal(body, &marker) != nil || marker.Blocked == nil {
		return true
	}
	return *marker.Blocked
}
