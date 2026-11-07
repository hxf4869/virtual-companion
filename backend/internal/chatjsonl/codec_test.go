package chatjsonl

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
)

const headerLine = `{"chat_metadata":{},"unknown":{"integer":900719925474099312345}}`

func TestSemanticRoundTrip(t *testing.T) {
	message := `{"mes":"选中","swipes":["旧候选","选中"],"swipe_id":1,"swipe_info":[{"extra":{"unknown":"留存"},"other":{"large":900719925474099312345}},{"extra":{"n":1.0},"send_date":"today","unknown":[null,true]}],"extra":{"n":1},"send_date":"today","variables":[{"nested":{"all":true}},null],"hidden":true,"unknown":{"ref":"opaque-value"}}`
	input := headerLine + "\r\n" + message // CRLF header, final message without LF.
	var header, row Object
	var output bytes.Buffer
	writer := NewWriter(&output)
	result, err := Read(strings.NewReader(input), Handlers{
		OnHeader: func(value Object) error { header = value; return writer.WriteHeader(value) },
		OnMessage: func(line int, value Object) error {
			if line != 2 {
				t.Fatal("incorrect physical line")
			}
			row = value
			return writer.WriteMessage(value)
		},
	})
	if err != nil || !result.Valid() || result.ValidatedMessages != 1 || result.ValidatedCandidates != 2 {
		t.Fatalf("unexpected validation: %#v, %v", result, err)
	}
	if got := header["unknown"].(map[string]any)["integer"]; got != json.Number("900719925474099312345") {
		t.Fatal("large integer changed")
	}
	if bytes.Contains(output.Bytes(), []byte("\r")) || bytes.Count(output.Bytes(), []byte("\n")) != 2 {
		t.Fatal("output must have exactly two LF-terminated lines")
	}
	var roundHeader, roundRow Object
	again, err := Read(&output, Handlers{
		OnHeader:  func(value Object) error { roundHeader = value; return nil },
		OnMessage: func(_ int, value Object) error { roundRow = value; return nil },
	})
	if err != nil || !again.Valid() || !reflect.DeepEqual(header, roundHeader) || !reflect.DeepEqual(row, roundRow) {
		t.Fatal("JSONL round trip changed header, candidates, variables or extension values")
	}
}

func TestValidCandidateStructures(t *testing.T) {
	for _, row := range []string{
		`{"mes":"a"}`,
		`{"mes":"b","swipes":["a","b"],"swipe_id":1,"swipe_info":[{}],"variables":{"0":null,"1":{"x":4}}}`,
		`{"mes":"a","swipes":["a","b"],"variables":[]}`,
		`{"mes":"a","extra":{"x":1e999999999},"swipe_info":[{"extra":{"x":10e999999998}}]}`,
	} {
		result, err := Read(strings.NewReader(headerLine+"\n"+row+"\n"), Handlers{})
		if err != nil || !result.Valid() {
			t.Fatalf("valid candidate structure rejected: %#v, %v", result, err)
		}
	}
}

func TestUnpairedSurrogateEscapesAreRejected(t *testing.T) {
	for _, extension := range []string{
		`"extension":"\ud800"`, `"extension":"\udfff"`,
		`"\ud800":"extension"`, `"\udfff":"extension"`,
		`"extension":"\ud800\u0041"`, `"extension":"\udc00\ud800"`,
	} {
		for _, inHeader := range []bool{false, true} {
			input := headerLine + "\n" + `{"mes":"valid",` + extension + `}`
			line := 2
			if inHeader {
				input = `{"chat_metadata":{},` + extension + `}`
				line = 1
			}
			result, err := Read(strings.NewReader(input), Handlers{})
			if err != nil || result.Valid() || !result.Complete || len(result.Issues) != 1 || result.Issues[0] != (Issue{line, InvalidCode, "INVALID_JSON"}) {
				t.Fatalf("unpaired surrogate accepted: line=%d, %#v, %v", line, result, err)
			}
		}
	}
}

func TestPairedSurrogatesAndLiteralBackslashesArePreserved(t *testing.T) {
	const message = `{"mes":"valid","\uD83D\uDE00":"\uD83D\uDE00","literal":"\\ud800","quoted":"\"\\udfff"}`
	var output bytes.Buffer
	writer := NewWriter(&output)
	result, err := Read(strings.NewReader(headerLine+"\n"+message), Handlers{
		OnHeader: writer.WriteHeader,
		OnMessage: func(_ int, message Object) error {
			if message["😀"] != "😀" || message["literal"] != `\ud800` || message["quoted"] != `"\udfff` {
				t.Fatal("paired surrogate or literal escape changed")
			}
			return writer.WriteMessage(message)
		},
	})
	if err != nil || !result.Valid() {
		t.Fatalf("valid string escapes rejected: %#v, %v", result, err)
	}
	result, err = Read(&output, Handlers{OnMessage: func(_ int, message Object) error {
		if message["😀"] != "😀" || message["literal"] != `\ud800` || message["quoted"] != `"\udfff` {
			t.Fatal("valid escapes changed on round trip")
		}
		return nil
	}})
	if err != nil || !result.Valid() {
		t.Fatal("valid escapes failed round trip")
	}
}

func TestInvalidRowsUseFixedDiagnostics(t *testing.T) {
	for _, test := range []struct{ name, row, reason string }{
		{"utf8", "{\"mes\":\"\xff\"}", "INVALID_UTF8"},
		{"trailing object", `{"mes":"secret"} {}`, "INVALID_JSON"},
		{"trailing invalid", `{"mes":"secret"} secret`, "INVALID_JSON"},
		{"array", `[]`, "INVALID_JSON"},
		{"null", `null`, "INVALID_JSON"},
		{"blank", ``, "INVALID_JSON"},
		{"whitespace", `  `, "INVALID_JSON"},
		{"missing mes", `{}`, "INVALID_MESSAGE"},
		{"wrong mes", `{"mes":23}`, "INVALID_MESSAGE"},
		{"empty swipes", `{"mes":"a","swipes":[]}`, "INVALID_MESSAGE"},
		{"wrong swipes", `{"mes":"a","swipes":{}}`, "INVALID_MESSAGE"},
		{"wrong candidate", `{"mes":"a","swipes":["a",null]}`, "INVALID_MESSAGE"},
		{"object candidate", `{"mes":"a","swipes":["a",{}]}`, "INVALID_MESSAGE"},
		{"wrong index type", `{"mes":"a","swipe_id":"0"}`, "INVALID_MESSAGE"},
		{"fraction index", `{"mes":"a","swipe_id":0.0}`, "INVALID_MESSAGE"},
		{"negative index", `{"mes":"a","swipe_id":-1}`, "INVALID_MESSAGE"},
		{"index out of range", `{"mes":"a","swipe_id":1}`, "INVALID_MESSAGE"},
		{"selection mismatch", `{"mes":"b","swipes":["a","b"]}`, "INVALID_MESSAGE"},
		{"info type", `{"mes":"a","swipe_info":{}}`, "INVALID_MESSAGE"},
		{"too much info", `{"mes":"a","swipe_info":[{},{}]}`, "INVALID_MESSAGE"},
		{"info not object", `{"mes":"a","swipe_info":[null]}`, "INVALID_MESSAGE"},
		{"extra not object", `{"mes":"a","extra":null}`, "INVALID_MESSAGE"},
		{"candidate extra not object", `{"mes":"a","swipe_info":[{"extra":[]}]}`, "INVALID_MESSAGE"},
		{"mirrored extra differs", `{"mes":"a","extra":{"x":1},"swipe_info":[{"extra":{"x":2}}]}`, "INVALID_MESSAGE"},
		{"mirrored timestamp differs", `{"mes":"a","send_date":"a","swipe_info":[{"send_date":"b"}]}`, "INVALID_MESSAGE"},
		{"variables scalar", `{"mes":"a","variables":false}`, "INVALID_MESSAGE"},
		{"too many variables", `{"mes":"a","variables":[null,null]}`, "INVALID_MESSAGE"},
		{"variables bad key", `{"mes":"a","variables":{"01":{}}}`, "INVALID_MESSAGE"},
		{"variables bad index", `{"mes":"a","variables":{"1":{}}}`, "INVALID_MESSAGE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			result, err := Read(strings.NewReader(headerLine+"\n"+test.row+"\n"), Handlers{OnMessage: func(int, Object) error { calls++; return nil }})
			if err != nil || result.Valid() || !result.Complete || calls != 0 || len(result.Issues) != 1 || result.Issues[0] != (Issue{2, InvalidCode, test.reason}) {
				t.Fatalf("unexpected fixed diagnostic: %#v, %v", result, err)
			}
		})
	}
}

func TestHeaderAndLastLineValidation(t *testing.T) {
	for _, input := range []string{"", `{"chat_metadata":null}`, `{"chat_metadata":[]}`} {
		result, err := Read(strings.NewReader(input), Handlers{})
		if err != nil || result.Valid() || len(result.Issues) != 1 || result.Issues[0] != (Issue{1, InvalidCode, "INVALID_HEADER"}) {
			t.Fatalf("invalid header accepted: %#v, %v", result, err)
		}
	}
	calls := 0
	result, err := Read(strings.NewReader(headerLine+"\n{\"mes\":\"valid\"}\n{\"mes\":"), Handlers{OnMessage: func(int, Object) error { calls++; return nil }})
	if err != nil || result.Valid() || !result.Complete || calls != 1 || len(result.Issues) != 1 || result.Issues[0] != (Issue{3, InvalidCode, "INVALID_JSON"}) {
		t.Fatalf("final error failed to invalidate earlier rows: %#v, %v", result, err)
	}
}

func TestLegacyHeaderWithoutMetadata(t *testing.T) {
	for _, input := range []string{`{}`, `{"user_name":"legacy","unknown":900719925474099312345}`} {
		var output bytes.Buffer
		writer := NewWriter(&output)
		result, err := Read(strings.NewReader(input), Handlers{OnHeader: func(header Object) error {
			if _, exists := header["chat_metadata"]; exists {
				t.Fatal("legacy header was mutated")
			}
			return writer.WriteHeader(header)
		}})
		if err != nil || !result.Valid() {
			t.Fatalf("legacy header rejected: %#v, %v", result, err)
		}
		want, _ := decodeObject([]byte(input))
		got, err := decodeObject(output.Bytes())
		if err != nil || !reflect.DeepEqual(want, got) {
			t.Fatal("legacy header fields changed during export")
		}
	}
	for _, metadata := range []any{nil, []any{}, "invalid"} {
		if NewWriter(io.Discard).WriteHeader(Object{"chat_metadata": metadata}) != ErrInvalidOutput {
			t.Fatal("explicit non-object metadata accepted by writer")
		}
	}
}

func TestHeaderByteBoundary(t *testing.T) {
	const base = `{"chat_metadata":{},"unknown":""}`
	for _, extra := range []int{0, 1} {
		header := `{"chat_metadata":{},"unknown":"` + strings.Repeat("a", MaxHeaderBytes-len(base)+extra) + `"}`
		calls := 0
		result, err := Read(strings.NewReader(header+"\r\n"+`{"mes":"valid tail"}`), Handlers{OnHeader: func(Object) error { calls++; return nil }})
		if err != nil || result.Valid() != (extra == 0) || !result.Complete || result.ValidatedMessages != 1 || calls != 1-extra {
			t.Fatalf("header limit boundary failed: extra=%d, %#v, %v", extra, result, err)
		}
		if extra != 0 && result.Issues[0] != (Issue{1, TooLargeCode, "HEADER_TOO_LARGE"}) {
			t.Fatal("wrong oversized document/header record diagnostic")
		}
	}
	if MaxHeaderBytes != 8<<20 {
		t.Fatal("header byte limit changed")
	}
}

func TestMessageByteBoundary(t *testing.T) {
	base := `{"mes":""}`
	for _, ending := range []string{"", "\n", "\r\n"} {
		for _, extra := range []int{0, 1} {
			row := `{"mes":"` + strings.Repeat("a", MaxMessageBytes-len(base)+extra) + `"}`
			result, err := Read(strings.NewReader(headerLine+"\n"+row+ending), Handlers{})
			if err != nil || result.Valid() != (extra == 0) || !result.Complete {
				t.Fatalf("message limit boundary failed: extra=%d ending=%q, %#v, %v", extra, ending, result, err)
			}
			if extra != 0 && result.Issues[0] != (Issue{2, TooLargeCode, "MESSAGE_TOO_LARGE"}) {
				t.Fatal("wrong oversized message diagnostic")
			}
		}
	}
}

func TestFileByteBoundaryAndConsumption(t *testing.T) {
	// Exercise the same bounded reader with small limits, including line endings.
	input := headerLine + "\n" + `{"mes":"a"}` + "\n"
	for _, extra := range []string{"", "x"} {
		reader := &trackingReader{Reader: strings.NewReader(input + extra)}
		result, err := read(reader, Handlers{}, MaxMessageBytes, int64(len(input)))
		if err != nil || result.Valid() != (extra == "") || result.Complete != (extra == "") {
			t.Fatalf("file boundary failed: %#v, %v", result, err)
		}
		if extra == "" && !reader.eof {
			t.Fatal("success without consuming EOF")
		}
		if extra != "" && result.Issues[len(result.Issues)-1] != (Issue{3, TooLargeCode, "FILE_TOO_LARGE"}) {
			t.Fatal("wrong oversized file diagnostic")
		}
	}
	if MaxFileBytes != 256<<20 || MaxMessageBytes != 1<<20 {
		t.Fatal("contract byte limits changed")
	}
}

func TestIssueCapContinuesToEOF(t *testing.T) {
	for _, count := range []int{100, 101} {
		reader := &trackingReader{Reader: strings.NewReader(headerLine + "\n" + strings.Repeat("bad\n", count) + `{"mes":"valid tail"}`)}
		result, err := Read(reader, Handlers{})
		if err != nil || result.Valid() || !result.Complete || !reader.eof || len(result.Issues) != MaxIssues || result.IssuesTruncated != (count > MaxIssues) || result.ValidatedMessages != 1 {
			t.Fatalf("issue cap failed: %#v, %v", result, err)
		}
		if result.Issues[99].Line != 101 {
			t.Fatal("issue line numbering changed")
		}
	}
}

func TestActualFileLimitOnOversizedStreamingLine(t *testing.T) {
	prefix := headerLine + "\n"
	padding := repeatingReader{block: bytes.Repeat([]byte{' '}, 32<<10)}
	for _, extra := range []int64{0, 1} {
		reader := io.MultiReader(strings.NewReader(prefix), io.LimitReader(padding, MaxFileBytes-int64(len(prefix))+extra))
		result, err := Read(reader, Handlers{})
		if err != nil || result.Valid() || result.Complete != (extra == 0) || len(result.Issues) != 1 {
			t.Fatalf("actual file limit failed: %#v, %v", result, err)
		}
		reason := "MESSAGE_TOO_LARGE"
		if extra != 0 {
			reason = "FILE_TOO_LARGE"
		}
		if result.Issues[0] != (Issue{2, TooLargeCode, reason}) {
			t.Fatal("incorrect actual file limit diagnostic")
		}
	}
}

func TestReadAndCallbackErrorsCannotSignalSuccess(t *testing.T) {
	secretError := errors.New("private input")
	result, err := Read(io.MultiReader(strings.NewReader(headerLine+"\n"), brokenReader{secretError}), Handlers{})
	if err != ErrRead || result.Complete || strings.Contains(err.Error(), "private") {
		t.Fatal("read error was hidden or leaked")
	}
	for _, handler := range []Handlers{
		{OnHeader: func(Object) error { return secretError }},
		{OnMessage: func(int, Object) error { return secretError }},
	} {
		result, err = Read(strings.NewReader(headerLine+"\n"+`{"mes":"a"}`), handler)
		if err != secretError || result.Valid() || result.Complete {
			t.Fatal("callback error was hidden")
		}
	}
}

func TestWriterErrorsAndUTF8(t *testing.T) {
	header := Object{"chat_metadata": Object{}}
	for _, output := range []io.Writer{brokenWriter{}, shortWriter{}} {
		if NewWriter(output).WriteHeader(header) != ErrWrite {
			t.Fatal("writer failure was hidden")
		}
	}
	var output bytes.Buffer
	writer := NewWriter(&output)
	if writer.WriteMessage(Object{"mes": "a"}) != ErrInvalidOutput || writer.WriteHeader(header) != nil || writer.WriteHeader(header) != ErrInvalidOutput {
		t.Fatal("header ordering was not enforced")
	}
	for _, row := range []Object{
		{"mes": "\xff"}, {"\xff": true}, {"mes": make(chan int)}, {"mes": json.RawMessage("\"\xff\"")},
	} {
		before := output.Len()
		if writer.WriteMessage(row) != ErrInvalidOutput || output.Len() != before {
			t.Fatal("invalid UTF-8 or unsupported output written")
		}
	}
}

type trackingReader struct {
	io.Reader
	eof bool
}

func (r *trackingReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.eof = r.eof || err == io.EOF
	return n, err
}

type brokenReader struct{ err error }

func (r brokenReader) Read([]byte) (int, error) { return 0, r.err }

type repeatingReader struct{ block []byte }

func (r repeatingReader) Read(p []byte) (int, error) { return copy(p, r.block), nil }

type brokenWriter struct{}

func (brokenWriter) Write([]byte) (int, error) { return 0, errors.New("private output") }

type shortWriter struct{}

func (shortWriter) Write(p []byte) (int, error) { return len(p) - 1, nil }
