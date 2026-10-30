package voice

import (
	"encoding/binary"
)

// WAVDuration validates the actual engine output before publishing a ready
// clip. Only the documented 24 kHz mono 16-bit PCM format is accepted.
func WAVDuration(data []byte) (int, error) {
	if len(data) < 44 || len(data) > MaxAudioBytes || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
		return 0, ErrUnavailable
	}
	formatOK := false
	dataSize := 0
	for at := 12; at+8 <= len(data); {
		size := int64(binary.LittleEndian.Uint32(data[at+4 : at+8]))
		start := at + 8
		if size > int64(len(data)-start) {
			return 0, ErrUnavailable
		}
		switch string(data[at : at+4]) {
		case "fmt ":
			if size < 16 {
				return 0, ErrUnavailable
			}
			f := data[start : start+16]
			formatOK = binary.LittleEndian.Uint16(f[0:2]) == 1 && binary.LittleEndian.Uint16(f[2:4]) == 1 && binary.LittleEndian.Uint32(f[4:8]) == 24000 && binary.LittleEndian.Uint32(f[8:12]) == 48000 && binary.LittleEndian.Uint16(f[12:14]) == 2 && binary.LittleEndian.Uint16(f[14:16]) == 16
		case "data":
			dataSize += int(size)
		}
		at = start + int(size) + (int(size) & 1)
	}
	if !formatOK || dataSize <= 0 || dataSize%2 != 0 {
		return 0, ErrUnavailable
	}
	return (dataSize*1000 + 47999) / 48000, nil
}
