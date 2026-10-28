// Package memorytime interprets a bounded set of explicit Chinese date
// expressions using the immutable timestamp and timezone of their source.
// It does not schedule reminders or use the extraction worker's clock.
package memorytime

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	StatusNone               = "none"
	StatusExplicitDate       = "explicit_date"
	StatusNormalized         = "normalized"
	StatusNeedsClarification = "needs_clarification"
)

// Result describes local calendar data, not a scheduled instant. Unknown
// fields remain JSON null; a date-only event is never converted to midnight.
// The caller stores the original source timestamp/timezone separately from
// recorded_at, and preserves this result through extraction retries.
type Result struct {
	SourceExpression    string     `json:"sourceExpression"`
	NormalizationRule   string     `json:"normalizationRule"`
	NormalizationStatus string     `json:"normalizationStatus"`
	EventDate           *string    `json:"eventDate"`
	EventTime           *string    `json:"eventTime"`
	EventTimezone       *string    `json:"eventTimezone"`
	TimePrecision       *string    `json:"timePrecision"`
	ReminderAt          *time.Time `json:"reminderAt"`
}

var (
	// 号 is the same calendar day as 日. Chinese numerals cover 十月三十号 and
	// 十一月六日; a bare 10号 still has no month and stays unresolved.
	datePattern  = regexp.MustCompile(`(?:([0-9]{4})年)?([0-9]{1,2})月([0-9]{1,2})[日号]|([0-9]{4})-([0-9]{2})-([0-9]{2})|下周([一二三四五六日天])|今天|明天|后天|(?:([0-9]{4})年)?([一二三四五六七八九十]{1,3})月([一二三四五六七八九十]{1,3})[日号]`)
	clockPattern = regexp.MustCompile(`([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?`)
	// These are temporal expressions we recognize as incomplete, not formats
	// whose meaning we silently infer from the extraction time.
	temporalPattern  = regexp.MustCompile(`周[一二三四五六日天末]|星期|下周|下下周|下个?月|[上中下]旬|[0-9一二三四五六七八九十]+[年月日号点时]|明[早晚]|今晚|后天|今天|月底|月初|某天|改天|早上|上午|中午|下午|傍晚|晚上|夜里|凌晨`)
	ambiguousPattern = regexp.MustCompile(`也许|可能|大概|左右|前后|或者|或是|不确定|不是|下下周|大后天|早上|上午|中午|下午|傍晚|晚上|夜里|凌晨|明早|明晚|今晚`)
)

// Normalize also handles queries: callers pass the query's own timestamp and
// timezone, and must not overwrite an existing event with that query result.
// Supported dates are YYYY-MM-DD, YYYY年M月D日/号, M月D日/号 (source year),
// the same forms written with Chinese numerals (十月三十号, 2026年十一月六日),
// 下周一..日 (next Monday-based calendar week), 今天/明天/后天, optionally
// followed by an unambiguous 24-hour HH:mm time. Other temporal expressions
// stay pending clarification. A numeric offset on sourceTimestamp does not
// substitute for a missing sourceTimezone snapshot.
func Normalize(expression string, sourceTimestamp time.Time, sourceTimezone string) Result {
	result := Result{NormalizationStatus: StatusNone}
	dates := datePattern.FindAllStringSubmatchIndex(expression, -1)
	clocks := clockPattern.FindAllStringSubmatchIndex(expression, -1)
	if len(dates) == 0 && len(clocks) == 0 && !temporalPattern.MatchString(expression) {
		return result
	}
	result.SourceExpression = strings.TrimSpace(expression)
	result.NormalizationStatus = StatusNeedsClarification
	if len(dates) != 1 || len(clocks) > 1 {
		result.NormalizationRule = "SINGLE_DATE_REQUIRED"
		return result
	}
	date := dates[0]
	// Do not interpret a valid-looking suffix of a malformed numeric date.
	if digitAdjacent(expression, date[0], date[1]) {
		result.NormalizationRule = "INVALID_DATE"
		return result
	}
	if ambiguousPattern.MatchString(expression) {
		result.NormalizationRule = "AMBIGUOUS_EXPRESSION"
		return result
	}
	// An additional unsupported temporal phrase must not disappear merely
	// because one supported date was found elsewhere in the same sentence.
	remainder := expression[:date[0]] + expression[date[1]:]
	remainder = clockPattern.ReplaceAllString(remainder, "")
	if temporalPattern.MatchString(remainder) {
		result.NormalizationRule = "UNRESOLVED_EXPRESSION"
		return result
	}
	if sourceTimezone == "" || sourceTimezone == "Local" {
		result.NormalizationRule = "SOURCE_TIMEZONE_REQUIRED"
		return result
	}
	location, err := time.LoadLocation(sourceTimezone)
	if err != nil {
		result.NormalizationRule = "SOURCE_TIMEZONE_REQUIRED"
		return result
	}
	part := func(n int) string {
		if date[n*2] < 0 {
			return ""
		}
		return expression[date[n*2]:date[n*2+1]]
	}
	matched := expression[date[0]:date[1]]
	var year, month, day int
	status := StatusNormalized
	switch {
	case part(1) != "" || part(4) != "" || part(8) != "":
		if part(8) != "" {
			var okM, okD bool
			year, _ = strconv.Atoi(part(8))
			month, okM = chineseNumber(part(9))
			day, okD = chineseNumber(part(10))
			if !okM || !okD {
				result.NormalizationRule = "INVALID_DATE"
				return result
			}
		} else {
			y, m, d := part(1), part(2), part(3)
			if part(4) != "" {
				y, m, d = part(4), part(5), part(6)
			}
			year, _ = strconv.Atoi(y)
			month, _ = strconv.Atoi(m)
			day, _ = strconv.Atoi(d)
		}
		result.NormalizationRule = "EXPLICIT_CALENDAR_DATE"
		status = StatusExplicitDate
	default:
		if sourceTimestamp.IsZero() {
			result.NormalizationRule = "SOURCE_TIMESTAMP_REQUIRED"
			return result
		}
		local := sourceTimestamp.In(location)
		base := time.Date(local.Year(), local.Month(), local.Day(), 12, 0, 0, 0, location)
		switch {
		case part(2) != "":
			year = local.Year()
			month, _ = strconv.Atoi(part(2))
			day, _ = strconv.Atoi(part(3))
			result.NormalizationRule = "MONTH_DAY_IN_SOURCE_YEAR"
		case part(9) != "":
			var okM, okD bool
			year = local.Year()
			month, okM = chineseNumber(part(9))
			day, okD = chineseNumber(part(10))
			if !okM || !okD {
				result.NormalizationRule = "INVALID_DATE"
				return result
			}
			result.NormalizationRule = "MONTH_DAY_IN_SOURCE_YEAR"
		case part(7) != "":
			weekday := map[string]int{"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}[part(7)]
			mondayOffset := (int(local.Weekday()) + 6) % 7
			base = base.AddDate(0, 0, 7-mondayOffset+weekday)
			year, month, day = base.Year(), int(base.Month()), base.Day()
			result.NormalizationRule = "ISO_WEEK_NEXT_WEEK_" + strings.ToUpper(base.Weekday().String()) + "_IN_SOURCE_TIMEZONE"
		default:
			offset := map[string]int{"今天": 0, "明天": 1, "后天": 2}[matched]
			base = base.AddDate(0, 0, offset)
			year, month, day = base.Year(), int(base.Month()), base.Day()
			result.NormalizationRule = "RELATIVE_DAY_IN_SOURCE_TIMEZONE"
		}
	}
	calendar := time.Date(year, time.Month(month), day, 12, 0, 0, 0, location)
	if year < 1 || calendar.Year() != year || int(calendar.Month()) != month || calendar.Day() != day {
		result.NormalizationRule = "INVALID_DATE"
		return result
	}
	var eventTime *string
	precision := "date"
	if len(clocks) == 1 {
		clock := clocks[0]
		hour, _ := strconv.Atoi(expression[clock[2]:clock[3]])
		minute, _ := strconv.Atoi(expression[clock[4]:clock[5]])
		if hour > 23 || minute > 59 || clock[6] >= 0 || digitAdjacent(expression, clock[0], clock[1]) {
			result.NormalizationRule = "INVALID_OR_UNSUPPORTED_TIME"
			return result
		}
		value := fmt.Sprintf("%02d:%02d", hour, minute)
		eventTime = &value
		precision = "minute"
		result.SourceExpression = matched + " " + expression[clock[0]:clock[1]]
	} else {
		result.SourceExpression = matched
	}
	eventDate := calendar.Format("2006-01-02")
	result.NormalizationStatus = status
	result.EventDate, result.EventTime = &eventDate, eventTime
	result.EventTimezone, result.TimePrecision = &sourceTimezone, &precision
	return result
}

func chineseNumber(s string) (int, bool) {
	digit := map[rune]int{'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	r := []rune(s)
	switch len(r) {
	case 1:
		if r[0] == '十' {
			return 10, true
		}
		n, ok := digit[r[0]]
		return n, ok
	case 2:
		if r[0] == '十' {
			n, ok := digit[r[1]]
			return 10 + n, ok
		}
		if r[1] == '十' {
			n, ok := digit[r[0]]
			if !ok || n > 3 {
				return 0, false
			}
			return n * 10, true
		}
	case 3:
		if r[1] != '十' {
			return 0, false
		}
		a, oka := digit[r[0]]
		b, okb := digit[r[2]]
		if !oka || !okb || a > 3 {
			return 0, false
		}
		return a*10 + b, true
	}
	return 0, false
}

func digitAdjacent(s string, start, end int) bool {
	isDigit := func(c byte) bool { return c >= '0' && c <= '9' }
	return (isDigit(s[start]) && start > 0 && isDigit(s[start-1])) ||
		(isDigit(s[end-1]) && end < len(s) && isDigit(s[end]))
}
