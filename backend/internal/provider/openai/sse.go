package openai

import (
	"io"
	"unicode/utf8"
)

const dataLineFraming = len("data: ")

func decodeSSE(r io.Reader, maxEvent, maxRaw int64, consume func(string) (bool, error)) error {
	if maxEvent <= 0 || maxRaw <= 0 {
		return errMalformed
	}
	buf := make([]byte, 4096)
	var event []byte
	hasData := false
	lineMode := lineStart
	fieldBytes := 0
	lineBytes := 0
	var raw int64
	skipLF := false

	flushLine := func() error {
		switch lineMode {
		case lineDataField:
			if fieldBytes != 4 {
				return errMalformed
			}
			if hasData {
				if int64(len(event)) >= maxEvent {
					return errMalformed
				}
				event = append(event, '\n')
			}
			hasData = true
		case lineStart:
			return nil
		case lineComment, lineBeforeValue, lineValue:
			return nil
		default:
			return errMalformed
		}
		return nil
	}

	dispatch := func() (bool, error) {
		if !hasData {
			return true, nil
		}
		if !utf8.Valid(event) {
			return false, errMalformed
		}
		data := string(event)
		event = event[:0]
		hasData = false
		return consume(data)
	}

	appendValue := func(b byte) error {
		if int64(len(event)) >= maxEvent {
			return errMalformed
		}
		event = append(event, b)
		return nil
	}

	for {
		n, err := r.Read(buf)
		for i := 0; i < n; i++ {
			raw++
			if raw > maxRaw {
				return errMalformed
			}
			value := buf[i]
			if skipLF {
				skipLF = false
				if value == '\n' {
					continue
				}
			}
			if value == '\r' || value == '\n' {
				if lineBytes == 0 {
					cont, dispErr := dispatch()
					if dispErr != nil {
						return dispErr
					}
					if !cont {
						return nil
					}
				} else if ferr := flushLine(); ferr != nil {
					return ferr
				}
				lineMode = lineStart
				fieldBytes = 0
				lineBytes = 0
				skipLF = value == '\r'
				continue
			}
			lineBytes++
			maxLine := maxEvent
			if lineMode != lineComment {
				maxLine = maxEvent + int64(dataLineFraming)
			}
			if int64(lineBytes) > maxLine {
				return errMalformed
			}
			switch lineMode {
			case lineStart:
				if value == ':' {
					lineMode = lineComment
					continue
				}
				if value != 'd' {
					return errMalformed
				}
				lineMode = lineDataField
				fieldBytes = 1
			case lineDataField:
				want := []byte("data")
				if fieldBytes < len(want) {
					if value != want[fieldBytes] {
						return errMalformed
					}
					fieldBytes++
					continue
				}
				if value != ':' {
					return errMalformed
				}
				if hasData {
					if int64(len(event)) >= maxEvent {
						return errMalformed
					}
					event = append(event, '\n')
				}
				hasData = true
				lineMode = lineBeforeValue
			case lineBeforeValue:
				lineMode = lineValue
				if value != ' ' {
					if aerr := appendValue(value); aerr != nil {
						return aerr
					}
				}
			case lineValue:
				if aerr := appendValue(value); aerr != nil {
					return aerr
				}
			case lineComment:
			}
		}
		if err == io.EOF {
			if lineBytes > 0 {
				if ferr := flushLine(); ferr != nil {
					return ferr
				}
			}
			if hasData {
				_, dispErr := dispatch()
				return dispErr
			}
			return nil
		}
		if err != nil {
			return err
		}
	}
}

type lineMode int

const (
	lineStart lineMode = iota
	lineDataField
	lineBeforeValue
	lineValue
	lineComment
)
