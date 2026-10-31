package proactive

import (
	"regexp"
	"strings"
)

var topicQuotes = regexp.MustCompile("「[^」]*」|“[^”]*”|\"[^\"]*\"")

// TopicAction conservatively records only an explicit unfinished conversation.
// Empty means preserve the previous reference; no model guesses a topic.
func TopicAction(text string) string {
	text = topicQuotes.ReplaceAllString(text, "")
	for _, term := range []string{"不聊这个", "换个话题", "这事解决了", "已经解决了", "都说完了", "已经聊完", "不用再聊"} {
		if strings.Contains(text, term) {
			return "clear"
		}
	}
	for _, term := range []string{"还没聊完", "还没说完", "回头接着聊", "回头接着说", "下次接着聊", "下次接着说", "晚点继续聊", "晚点接着说"} {
		if strings.Contains(text, term) {
			return "open"
		}
	}
	return ""
}
