// Package chatjsonl reads and writes the SillyTavern JSONL document format.
// It does not assign identities, authorize imports, or publish partial results.
package chatjsonl

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"reflect"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	MaxMessageBytes = 1 << 20
	// MaxHeaderBytes bounds the document/header record to the metadata operation budget.
	MaxHeaderBytes = 8 << 20
	MaxFileBytes   = 256 << 20
	MaxIssues      = 100
	InvalidCode    = "CHAT_IMPORT_INVALID"
	TooLargeCode   = "CHAT_PAYLOAD_TOO_LARGE"
)

// Object retains unknown fields and json.Number values without float conversion.
type Object = map[string]any

// Issue contains only fixed diagnostics, never input text or identifiers.
type Issue struct {
	Line   int    `json:"line"`
	Code   string `json:"code"`
	Reason string `json:"reason"`
}

type Result struct {
	Complete            bool
	ValidatedMessages   int64
	ValidatedCandidates int64
	Issues              []Issue
	IssuesTruncated     bool
}

// Valid requires EOF; callbacks must stage work until this returns true.
func (r Result) Valid() bool { return r.Complete && len(r.Issues) == 0 }

type Handlers struct {
	OnHeader  func(Object) error
	OnMessage func(line int, message Object) error
}

var (
	ErrRead          = errors.New("chat JSONL read failed")
	ErrWrite         = errors.New("chat JSONL write failed")
	ErrInvalidOutput = errors.New("invalid chat JSONL output")
)

// Read validates every physical line, including empty lines. LF and CRLF are
// accepted, as is a final line without LF. A terminating LF adds no empty line.
// Invalid rows produce bounded issues and are not delivered to callbacks. Other
// valid rows may already have been delivered when a later row fails. Callbacks
// own their objects and may retain or mutate them. Callback errors are returned
// unchanged; callers must not include input text in those errors.
//
// The raw message line limit excludes CRLF. The store must also check the final
// canonical document after assigning server identities and projecting candidates.
// A legacy header without chat_metadata represents empty metadata; its original
// fields are passed through unchanged. Header records have a separate 8 MiB cap.
func Read(r io.Reader, h Handlers) (Result, error) {
	return read(r, h, MaxMessageBytes, MaxFileBytes)
}

func read(r io.Reader, h Handlers, messageLimit, fileLimit int64) (Result, error) {
	result := Result{Issues: []Issue{}}
	// The extra byte distinguishes an exactly full file from an oversized one.
	limited := &io.LimitedReader{R: r, N: fileLimit + 1}
	reader := bufio.NewReaderSize(limited, 32<<10)
	line, total := 1, int64(0)
	for {
		limit := messageLimit
		if line == 1 {
			limit = MaxHeaderBytes
		}
		var raw []byte
		tooLarge, hasBytes := false, false
		var readErr error
		for {
			part, err := reader.ReadSlice('\n')
			total += int64(len(part))
			if total > fileLimit {
				result.add(line, TooLargeCode, "FILE_TOO_LARGE")
				return result, nil
			}
			hasBytes = hasBytes || len(part) > 0
			// Keep at most the line limit plus CRLF, even for a huge bad row.
			if !tooLarge {
				if int64(len(raw))+int64(len(part)) > limit+2 {
					tooLarge = true
					raw = nil
				} else {
					raw = append(raw, part...)
				}
			}
			if err != bufio.ErrBufferFull {
				readErr = err
				break
			}
		}
		if readErr != nil && readErr != io.EOF {
			return result, ErrRead
		}
		if !hasBytes && readErr == io.EOF {
			if line == 1 {
				result.add(1, InvalidCode, "INVALID_HEADER")
			}
			result.Complete = true
			return result, nil
		}
		if len(raw) > 0 && raw[len(raw)-1] == '\n' {
			raw = raw[:len(raw)-1]
			if len(raw) > 0 && raw[len(raw)-1] == '\r' {
				raw = raw[:len(raw)-1]
			}
		}
		tooLarge = tooLarge || int64(len(raw)) > limit
		if tooLarge {
			reason := "MESSAGE_TOO_LARGE"
			if line == 1 {
				reason = "HEADER_TOO_LARGE"
			}
			result.add(line, TooLargeCode, reason)
		} else if !utf8.Valid(raw) {
			result.add(line, InvalidCode, "INVALID_UTF8")
		} else {
			object, err := decodeObject(raw)
			if err != nil {
				result.add(line, InvalidCode, "INVALID_JSON")
			} else if line == 1 {
				if !validHeader(object) {
					result.add(line, InvalidCode, "INVALID_HEADER")
				} else if h.OnHeader != nil {
					if err := h.OnHeader(object); err != nil {
						return result, err
					}
				}
			} else if candidates, ok := validateMessage(object); !ok {
				result.add(line, InvalidCode, "INVALID_MESSAGE")
			} else {
				if h.OnMessage != nil {
					if err := h.OnMessage(line, object); err != nil {
						return result, err
					}
				}
				result.ValidatedMessages++
				result.ValidatedCandidates += int64(candidates)
			}
		}
		if readErr == io.EOF {
			result.Complete = true
			return result, nil
		}
		line++
	}
}

func (r *Result) add(line int, code, reason string) {
	if len(r.Issues) < MaxIssues {
		r.Issues = append(r.Issues, Issue{Line: line, Code: code, Reason: reason})
	} else {
		r.IssuesTruncated = true
	}
}

func decodeObject(raw []byte) (Object, error) {
	// encoding/json replaces unpaired UTF-16 escapes with U+FFFD. Reject those
	// escapes before decoding so unknown keys and values cannot silently change.
	if !validSurrogateEscapes(raw) {
		return nil, ErrInvalidOutput
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var object Object
	if err := decoder.Decode(&object); err != nil || object == nil {
		return nil, ErrInvalidOutput
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, ErrInvalidOutput
	}
	return object, nil
}

func validSurrogateEscapes(raw []byte) bool {
	for i := 0; i < len(raw); i++ {
		if raw[i] != '\\' {
			continue
		}
		i++ // An escaped backslash or quote must not start another escape.
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		unit, err := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if unit >= 0xdc00 && unit <= 0xdfff {
			return false
		}
		if unit < 0xd800 || unit > 0xdbff {
			continue
		}
		if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
			return false
		}
		low, err := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
		if err != nil || low < 0xdc00 || low > 0xdfff {
			return false
		}
		i += 6
	}
	return true
}

func validHeader(header Object) bool {
	metadata, exists := header["chat_metadata"]
	if !exists {
		return true
	}
	_, ok := metadata.(map[string]any)
	return ok
}

// Validation mirrors the candidate structure accepted by the stored-chat writer;
// it deliberately does not interpret extension identities or references.
func validateMessage(object Object) (int, bool) {
	text, ok := object["mes"].(string)
	if !ok {
		return 0, false
	}
	texts := []any{text}
	if raw, exists := object["swipes"]; exists {
		texts, ok = raw.([]any)
		if !ok || len(texts) == 0 {
			return 0, false
		}
	}
	selected := 0
	if raw, exists := object["swipe_id"]; exists {
		n, ok := raw.(json.Number)
		if !ok {
			return 0, false
		}
		index, err := n.Int64()
		if err != nil || index < 0 || index >= int64(len(texts)) {
			return 0, false
		}
		selected = int(index)
	}
	if texts[selected] != text {
		return 0, false
	}
	var info []any
	if raw, exists := object["swipe_info"]; exists {
		info, ok = raw.([]any)
		if !ok || len(info) > len(texts) {
			return 0, false
		}
	}
	if raw, exists := object["variables"]; exists {
		switch variables := raw.(type) {
		case []any:
			if len(variables) > len(texts) {
				return 0, false
			}
		case map[string]any:
			for key := range variables {
				index, err := strconv.Atoi(key)
				if err != nil || index < 0 || index >= len(texts) || strconv.Itoa(index) != key {
					return 0, false
				}
			}
		default:
			return 0, false
		}
	}
	if raw, exists := object["extra"]; exists {
		if _, ok := raw.(map[string]any); !ok {
			return 0, false
		}
	}
	for i, rawText := range texts {
		if _, ok := rawText.(string); !ok {
			return 0, false
		}
		if i >= len(info) {
			continue
		}
		candidate, ok := info[i].(map[string]any)
		if !ok {
			return 0, false
		}
		if raw, exists := candidate["extra"]; exists {
			if _, ok := raw.(map[string]any); !ok {
				return 0, false
			}
		}
		if i == selected {
			for _, key := range []string{"extra", "send_date", "gen_started", "gen_finished"} {
				outer, exists := object[key]
				inner, present := candidate[key]
				if exists && present && !equalJSON(outer, inner) {
					return 0, false
				}
			}
		}
	}
	return len(texts), true
}

func equalJSON(a, b any) bool {
	switch value := a.(type) {
	case json.Number:
		other, ok := b.(json.Number)
		return ok && canonicalNumber(value) == canonicalNumber(other)
	case map[string]any:
		other, ok := b.(map[string]any)
		if !ok || len(value) != len(other) {
			return false
		}
		for key, field := range value {
			second, exists := other[key]
			if !exists || !equalJSON(field, second) {
				return false
			}
		}
		return true
	case []any:
		other, ok := b.([]any)
		if !ok || len(value) != len(other) {
			return false
		}
		for i, field := range value {
			if !equalJSON(field, other[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(a, b)
	}
}

// Compare numeric spellings without allocating attacker-controlled powers of ten.
func canonicalNumber(number json.Number) string {
	s := string(number)
	negative := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	exponent := new(big.Int)
	if at := strings.IndexAny(s, "eE"); at >= 0 {
		exponent.SetString(s[at+1:], 10)
		s = s[:at]
	}
	if at := strings.IndexByte(s, '.'); at >= 0 {
		exponent.Sub(exponent, big.NewInt(int64(len(s)-at-1)))
		s = s[:at] + s[at+1:]
	}
	s = strings.TrimLeft(s, "0")
	if s == "" {
		return "0"
	}
	coefficient := strings.TrimRight(s, "0")
	exponent.Add(exponent, big.NewInt(int64(len(s)-len(coefficient))))
	if negative {
		coefficient = "-" + coefficient
	}
	return coefficient + "e" + exponent.String()
}

// Writer emits one JSON object per LF-terminated line. It does not buffer a chat.
// Once a write fails, discard the output: an io.Writer can have accepted a prefix.
type Writer struct {
	output io.Writer
	header bool
}

func NewWriter(w io.Writer) *Writer { return &Writer{output: w} }

func (w *Writer) WriteHeader(header Object) error {
	if w.header {
		return ErrInvalidOutput
	}
	if !validHeader(header) {
		return ErrInvalidOutput
	}
	if err := w.write(header); err != nil {
		return err
	}
	w.header = true
	return nil
}

func (w *Writer) WriteMessage(message Object) error {
	if !w.header {
		return ErrInvalidOutput
	}
	return w.write(message)
}

func (w *Writer) write(object Object) error {
	if object == nil {
		return ErrInvalidOutput
	}
	raw, err := json.Marshal(object)
	if err != nil || !utf8.Valid(raw) || !validStrings(reflect.ValueOf(object)) {
		return ErrInvalidOutput
	}
	raw = append(raw, '\n')
	n, err := w.output.Write(raw)
	if err != nil || n != len(raw) {
		return ErrWrite
	}
	return nil
}

// json.Marshal replaces invalid UTF-8 in strings; reject it before output instead.
// Marshal runs first so unsupported values and cycles never reach this walk.
func validStrings(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.Interface, reflect.Pointer:
		return v.IsNil() || validStrings(v.Elem())
	case reflect.String:
		return utf8.ValidString(v.String())
	case reflect.Map:
		iterator := v.MapRange()
		for iterator.Next() {
			if !validStrings(iterator.Key()) || !validStrings(iterator.Value()) {
				return false
			}
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < v.Len(); i++ {
			if !validStrings(v.Index(i)) {
				return false
			}
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if !validStrings(v.Field(i)) {
				return false
			}
		}
	}
	return true
}
