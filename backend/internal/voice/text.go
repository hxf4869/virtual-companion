package voice

import (
	"regexp"
	"strings"
	"unicode"
)

var speechTags = regexp.MustCompile(`(?i)<sticker\s+tag="[^"]*"\s*/>|<voice\s*/>|<[^>]*>`)
var speechActions = regexp.MustCompile(`（[^（）]*）|\([^()]*\)|\*[^*\n]+\*|＊[^＊\n]+＊`)
var speechBold = regexp.MustCompile(`\*\*([^*\n]+)\*\*`)
var speechLinks = regexp.MustCompile(`!?\[([^\]]*)\]\([^)]*\)`)
var speechList = regexp.MustCompile(`(?m)^\s*(?:#{1,6}\s+|[-+>]\s+|\d+[.)]\s+)`)
var speechFace = regexp.MustCompile(`[︿﹀╥╯╰┬┴┻┳┸ಥಠʕʔωДд▽∀益≧≦･ﾟ｡╭╮╰╯¯ツノヽヮ﹏]+|[TQ][_.][TQ]|[:;=][-^]?[)D(Pp]`)

// CleanText produces the spoken copy only. Clip.Text and the ST message retain
// their original form for transcripts and future prompt context.
func CleanText(text string) string {
	text = speechLinks.ReplaceAllString(text, "$1")
	text = speechTags.ReplaceAllString(text, "")
	text = speechBold.ReplaceAllString(text, "$1")
	text = speechActions.ReplaceAllString(text, "")
	text = speechList.ReplaceAllString(text, "")
	text = speechFace.ReplaceAllString(text, "")
	text = strings.NewReplacer("~", "，", "～", "，", "`", "", "_", "", "#", "", "*", "").Replace(text)
	var out strings.Builder
	var previous rune
	for _, r := range text {
		// Pictographs, regional flags, variation selectors, joiners and the
		// supplementary emoji blocks have no useful spoken representation.
		if r >= 0x1f000 && r <= 0x1ffff || r >= 0x2600 && r <= 0x27ff || r == 0xfe0f || r == 0x200d || r == 0x20e3 {
			continue
		}
		if unicode.IsSpace(r) {
			r = ' '
		}
		if (unicode.IsPunct(r) && unicode.IsPunct(previous)) || r == ' ' && previous == ' ' {
			continue
		}
		out.WriteRune(r)
		previous = r
	}
	return strings.TrimSpace(out.String())
}
