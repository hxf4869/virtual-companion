package story

import (
	"regexp"
	"strings"
)

// hiddenProjectionText matches the markers the story page refuses to render.
// A field that contains one is omitted as a whole, the same way the page's
// shown() filter works.
var hiddenProjectionText = regexp.MustCompile(`PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+`)

// ProjectionFallback is the chat line the story page writes when a player-visible
// event has no displayable clue name, text, note, or qualification.
const ProjectionFallback = "这一步行动已记录"

// PlayerProjectionLine is the chat text the story page projects for one
// player-visible event. Field order matches the page: clueName, text, note,
// qualification. Hidden markers and empty fields are dropped. The result never
// includes GM truth, another actor's private fact, or credentials.
func PlayerProjectionLine(clueName, text, note, qualification string) string {
	parts := make([]string, 0, 4)
	for _, value := range []string{clueName, text, note, qualification} {
		if value == "" || hiddenProjectionText.MatchString(value) {
			continue
		}
		parts = append(parts, value)
	}
	if len(parts) == 0 {
		return ProjectionFallback
	}
	return strings.Join(parts, "\n")
}
