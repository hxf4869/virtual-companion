package openai

import (
	"encoding/json"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

type utf16Join struct {
	pending uint16
}

func (j *utf16Join) append(units []uint16) (string, error) {
	if j.pending != 0 {
		buf := make([]uint16, 0, 1+len(units))
		buf = append(buf, j.pending)
		buf = append(buf, units...)
		units = buf
		j.pending = 0
	}
	if len(units) == 0 {
		return "", nil
	}
	last := units[len(units)-1]
	if utf16.IsSurrogate(rune(last)) && last >= 0xD800 && last <= 0xDBFF {
		j.pending = last
		units = units[:len(units)-1]
	}
	for i := 0; i < len(units); i++ {
		u := units[i]
		switch {
		case u >= 0xD800 && u <= 0xDBFF:
			if i+1 >= len(units) || units[i+1] < 0xDC00 || units[i+1] > 0xDFFF {
				return "", errMalformed
			}
			i++
		case u >= 0xDC00 && u <= 0xDFFF:
			return "", errMalformed
		}
	}
	return string(utf16.Decode(units)), nil
}

func (j *utf16Join) pendingIncomplete() bool {
	return j.pending != 0
}

func jsonStringUTF16(raw json.RawMessage) ([]uint16, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false, nil
	}
	if raw[0] != '"' {
		return nil, true, errMalformed
	}
	units, err := decodeJSONStringUTF16(raw)
	if err != nil {
		return nil, true, err
	}
	return units, true, nil
}

func decodeJSONStringUTF16(raw json.RawMessage) ([]uint16, error) {
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return nil, errMalformed
	}
	in := raw[1 : len(raw)-1]
	out := make([]uint16, 0, len(in))
	for i := 0; i < len(in); {
		c := in[i]
		if c != '\\' {
			r, n := utf8.DecodeRune(in[i:])
			if r == utf8.RuneError && n == 1 {
				return nil, errMalformed
			}
			out = append(out, utf16.Encode([]rune{r})...)
			i += n
			continue
		}
		if i+1 >= len(in) {
			return nil, errMalformed
		}
		switch in[i+1] {
		case '"', '\\', '/':
			out = append(out, uint16(in[i+1]))
			i += 2
		case 'b':
			out = append(out, '\b')
			i += 2
		case 'f':
			out = append(out, '\f')
			i += 2
		case 'n':
			out = append(out, '\n')
			i += 2
		case 'r':
			out = append(out, '\r')
			i += 2
		case 't':
			out = append(out, '\t')
			i += 2
		case 'u':
			if i+6 > len(in) {
				return nil, errMalformed
			}
			u, err := strconv.ParseUint(string(in[i+2:i+6]), 16, 16)
			if err != nil {
				return nil, errMalformed
			}
			out = append(out, uint16(u))
			i += 6
		default:
			return nil, errMalformed
		}
	}
	return out, nil
}
