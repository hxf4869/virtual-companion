package voice

import (
	"encoding/binary"
	"math"
)

// WAVDuration validates the actual engine output before publishing a ready
// clip. Only the documented 24 kHz mono 16-bit PCM format is accepted.
func WAVDuration(data []byte) (int, error) {
	return pcmWAVDuration(data, 24000, MaxAudioBytes)
}

// The installed CosyVoice audio encoder emits canonical Float32 WAV, while
// builds without that encoder emit PCM16. Publish only the existing PCM16 contract.
func cosyWAVToPCM16(data []byte) ([]byte, error) {
	if _, err := WAVDuration(data); err == nil {
		return data, nil
	}
	if len(data) < 48 || len(data) > MaxAudioBytes || string(data[:4]) != "RIFF" || string(data[8:16]) != "WAVEfmt " || string(data[36:40]) != "data" {
		return nil, ErrUnavailable
	}
	u16 := binary.LittleEndian.Uint16
	u32 := binary.LittleEndian.Uint32
	if uint64(u32(data[4:8]))+8 != uint64(len(data)) || u32(data[16:20]) != 16 ||
		u16(data[20:22]) != 3 || u16(data[22:24]) != 1 || u32(data[24:28]) != 24000 ||
		u32(data[28:32]) != 96000 || u16(data[32:34]) != 4 || u16(data[34:36]) != 32 ||
		uint64(u32(data[40:44])) != uint64(len(data)-44) || (len(data)-44)%4 != 0 {
		return nil, ErrUnavailable
	}
	pcm := make([]byte, 44+(len(data)-44)/2)
	copy(pcm, data[:44])
	binary.LittleEndian.PutUint32(pcm[4:8], uint32(len(pcm)-8))
	binary.LittleEndian.PutUint16(pcm[20:22], 1)
	binary.LittleEndian.PutUint32(pcm[28:32], 48000)
	binary.LittleEndian.PutUint16(pcm[32:34], 2)
	binary.LittleEndian.PutUint16(pcm[34:36], 16)
	binary.LittleEndian.PutUint32(pcm[40:44], uint32(len(pcm)-44))
	for source, target := 44, 44; source < len(data); source, target = source+4, target+2 {
		value := float64(math.Float32frombits(u32(data[source : source+4])))
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, ErrUnavailable
		}
		value = math.Max(-1, math.Min(1, value))
		if value < 0 {
			value *= 32768
		} else {
			value *= 32767
		}
		binary.LittleEndian.PutUint16(pcm[target:target+2], uint16(int16(value)))
	}
	return pcm, nil
}

func pcmWAVDuration(data []byte, rate, maxBytes int) (int, error) {
	if len(data) < 44 || len(data) > maxBytes || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
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
			formatOK = binary.LittleEndian.Uint16(f[0:2]) == 1 && binary.LittleEndian.Uint16(f[2:4]) == 1 && binary.LittleEndian.Uint32(f[4:8]) == uint32(rate) && binary.LittleEndian.Uint32(f[8:12]) == uint32(rate*2) && binary.LittleEndian.Uint16(f[12:14]) == 2 && binary.LittleEndian.Uint16(f[14:16]) == 16
		case "data":
			dataSize += int(size)
		}
		at = start + int(size) + (int(size) & 1)
	}
	if !formatOK || dataSize <= 0 || dataSize%2 != 0 {
		return 0, ErrUnavailable
	}
	return (dataSize*1000 + rate*2 - 1) / (rate * 2), nil
}
