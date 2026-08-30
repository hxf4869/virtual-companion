package modelhttp

import (
	"bufio"
	"io"
	"strings"
	"unicode/utf8"
)

// SSEEvent is one bounded Server-Sent Event. Event may be empty; Data joins
// multiple data fields with a newline as required by the SSE format.
type SSEEvent struct {
	Event string
	Data  string
}

func DecodeSSE(r io.Reader, maxEvent, maxRaw int64, consume func(SSEEvent) (bool, error)) error {
	if r == nil || consume == nil || maxEvent <= 0 || maxRaw <= 0 || maxEvent > int64(^uint(0)>>1)-256 {
		return ErrMalformed
	}
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 4096), int(maxEvent)+256)
	var eventName string
	var data []string
	var raw int64

	dispatch := func() (bool, error) {
		if len(data) == 0 {
			eventName = ""
			return true, nil
		}
		joined := strings.Join(data, "\n")
		if int64(len(joined)) > maxEvent || !utf8.ValidString(joined) || !utf8.ValidString(eventName) {
			return false, ErrMalformed
		}
		e := SSEEvent{Event: eventName, Data: joined}
		eventName = ""
		data = data[:0]
		return consume(e)
	}

	for scanner.Scan() {
		line := scanner.Text()
		raw += int64(len(line)) + 1
		if raw > maxRaw {
			return ErrOverLimit
		}
		if line == "" || line == "\r" {
			cont, err := dispatch()
			if err != nil || !cont {
				return err
			}
			continue
		}
		line = strings.TrimSuffix(line, "\r")
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			value = ""
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			if int64(len(value)) > maxEvent {
				return ErrMalformed
			}
			eventName = value
		case "data":
			data = append(data, value)
			if int64(len(strings.Join(data, "\n"))) > maxEvent {
				return ErrMalformed
			}
		case "id", "retry":
			// The model clients do not reconnect at the HTTP layer.
		default:
			// Unknown SSE fields are ignored per the wire format.
		}
	}
	if err := scanner.Err(); err != nil {
		return ErrMalformed
	}
	if len(data) > 0 {
		_, err := dispatch()
		return err
	}
	return nil
}
