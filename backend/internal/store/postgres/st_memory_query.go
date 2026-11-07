package postgres

import (
	"context"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	stRecentTopicTurns = 3
	stRecentTopicRunes = 256

	stTopicAnaphor = `(?:(?:这|那)(?:件(?:事(?:情)?)?|个(?:事(?:情)?|话题|计划|项目|安排|问题|方案)?|项(?:计划|安排|工作|项目)?)|它|此事)`
	stPriorTime    = `(?:上次|之前|刚才|刚刚)`
	stProgressAsk  = `(?:(?:谈|聊|讨论|说|走|做|推进|进展)?到哪(?:一)?步|进展(?:如何|怎么样)|有(?:什么)?进展|下一步(?:是|做|要做)?什么|接下来(?:做什么|怎么办))`
	stAskEnding    = `了?(?:吗|呢)?[？?。！!]*$`
)

// Match complete follow-ups. A named subject or a second, independent
// question stays on the normal retrieval path.
var (
	stProgressFollowup = regexp.MustCompile(`^(?:我(?:们)?|你)?(?:` + stPriorTime + `|后来|现在)?` + stProgressAsk + stAskEnding)
	stPriorDiscussion  = regexp.MustCompile(`^(?:我(?:们)?|你)?` + stPriorTime + `(?:谈|聊|讨论|说)(?:了?什么|到哪(?:里|儿))` + stAskEnding)
	stAnaphorFollowup  = regexp.MustCompile(`^(?:(?:` + stPriorTime + `|昨天|今天|明天)的?)?` + stTopicAnaphor +
		`的?(?:后来|现在|接下来)?(?:` + stProgressAsk + `|怎么样|如何|怎么办|怎么继续|有(?:什么)?结果|还记得|是什么)?` + stAskEnding)

	stContextClauses      = regexp.MustCompile(`[\n，,。！？!?；;：:]+`)
	stContextContinuation = regexp.MustCompile(`^(?:我(?:们)?)?(?:那就|先|再)?(?:继续|回顾|接着聊|聊聊|说说|讨论)(?:一下)?(?:吧|呢)?$`)
	stContextTopicIntro   = regexp.MustCompile(`^(?:今天|现在|最近)?(?:我(?:们)?)?(?:今天|现在|最近)?(?:(?:还|还是)?想(?:继续|聊聊?|讨论|回顾)|(?:继续|接着)(?:聊聊?|讨论|回顾)|关于)\s*(.+)$`)
	stContextTopicStatus  = regexp.MustCompile(`^(.+?)(?:也|还|已经)?(?:(?:搁置|搁|暂停|停|拖)(?:了)?(?:很久|好久|一阵子|一段时间)|没(?:开始|做完|结束|聊完|讨论完))$`)
	stContextTopicName    = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N} _·-]{1,39}$`)
	stContextTopicGeneric = regexp.MustCompile(`^(?:(?:这|那)(?:个|件|项|些)|(?:我|你|他|她|它)们?$|(?:此事|上次|之前|刚才|计划|项目|话题|事情|任务|工作|进度|方案|问题)$)`)
	stContextTopicMixed   = regexp.MustCompile(`以及|还有|也想|还是|但是|不过|另外|同时|然后|或者|顺便|不想|不要|别聊|改聊|[和与跟或]|(?:一下|吧)$`)
)

func stQueryNeedsRecentTopic(text string) bool {
	question := strings.TrimSpace(text)
	return stProgressFollowup.MatchString(question) || stPriorDiscussion.MatchString(question) || stAnaphorFollowup.MatchString(question)
}

// stRecallQueryText uses at most the three preceding user turns. Positions,
// the anchor and the conversation revision are checked in the same SQL read
// so an edit cannot combine the original question with a newer context.
func (s *Store) stRecallQueryText(ctx context.Context, owner int64, b stMemoryBinding, query stDigestSource) (string, error) {
	if !stQueryNeedsRecentTopic(query.text) {
		return query.text, nil
	}
	var turns []string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT CASE WHEN s.eligible AND NOT s.suppressed THEN left(s.content_cipher,$5) ELSE '' END
            FROM vc.conversation c
            JOIN vc.st_message_source q ON (q.owner_user_id,q.conversation_id)=(c.owner_user_id,c.id)
            JOIN vc.st_message_source s ON (s.owner_user_id,s.conversation_id)=(c.owner_user_id,c.id)
            WHERE c.owner_user_id=$1 AND c.id=$2 AND c.st_applied_revision=$3
              AND c.st_source_state='PRESENT' AND c.st_mode='COMPANION' AND NOT c.incognito
              AND q.source_ref=$4 AND q.present AND q.eligible AND NOT q.suppressed AND q.role='user'
              AND s.present AND s.role='user' AND s.source_position>0 AND s.source_position<q.source_position
            ORDER BY s.source_position DESC LIMIT $6`, owner, b.id, b.revision, query.ref, stRecentTopicRunes+1, stRecentTopicTurns)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var turn string
			if err := rows.Scan(&turn); err != nil {
				return err
			}
			turns = append(turns, turn)
		}
		return rows.Err()
	})
	if err != nil {
		return "", mapStoreErr(err)
	}
	if len(turns) == 0 {
		return query.text, nil
	}
	if topic := stRecentUserTopic(turns); topic != "" {
		return topic + "：" + query.text, nil
	}
	// A visible but inconclusive window must not seed retrieval or inject an
	// unrelated summary that could bias the assistant's clarification.
	return "", nil
}

func stRecentUserTopic(turns []string) string {
	var topic string
	for _, turn := range turns {
		if strings.TrimSpace(turn) == "" || utf8.RuneCountInString(turn) > stRecentTopicRunes {
			return ""
		}
		for _, part := range stContextClauses.Split(turn, -1) {
			part = strings.TrimSpace(part)
			if !shouldRecallMemory(part) || stContextContinuation.MatchString(part) || stQueryNeedsRecentTopic(part) {
				continue
			}
			named := stUserTopicName(part)
			if named == "" || (topic != "" && !strings.EqualFold(topic, named)) {
				return ""
			}
			topic = named
		}
	}
	return topic
}

func stUserTopicName(part string) string {
	match := stContextTopicIntro.FindStringSubmatch(part)
	if match == nil {
		match = stContextTopicStatus.FindStringSubmatch(part)
	}
	if match == nil {
		return ""
	}
	name := strings.TrimSpace(match[1])
	quoted := (strings.HasPrefix(name, "《") && strings.HasSuffix(name, "》")) ||
		(strings.HasPrefix(name, "“") && strings.HasSuffix(name, "”")) ||
		(strings.HasPrefix(name, `"`) && strings.HasSuffix(name, `"`))
	if quoted {
		name = strings.Trim(name, "《》“”\"")
	}
	if !stContextTopicName.MatchString(name) || stContextTopicGeneric.MatchString(name) ||
		(!quoted && (stContextTopicMixed.MatchString(name) || stQueryNeedsRecentTopic(name))) {
		return ""
	}
	return name
}
