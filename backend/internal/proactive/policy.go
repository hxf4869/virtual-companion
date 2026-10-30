package proactive

import "errors"

// ErrInvalidPolicy 表示模式或关心间隔不在契约范围内。
var ErrInvalidPolicy = errors.New("proactive policy is invalid")

// ResolveWrite 把省略的 mode / checkInAfterMinutes 补成可落库的值。
// 省略 mode 时，enabled=false 记为 OFF；enabled=true 保留已有的 DAILY、CLOSE_FRIEND、FOLLOW_UP，否则记为 FOLLOW_UP。
// 显式 mode 以 mode 为准。省略间隔时保留已有合法值，否则 720。
func ResolveWrite(existingMode string, existingCheck int, enabled, modeSet bool, mode string, checkSet bool, check int) (string, bool, int, error) {
	switch {
	case modeSet:
		switch mode {
		case ModeOff, ModeFollowUp, ModeDaily, ModeCloseFriend:
		default:
			return "", false, 0, ErrInvalidPolicy
		}
	case !enabled:
		mode = ModeOff
	case existingMode == ModeDaily || existingMode == ModeCloseFriend || existingMode == ModeFollowUp:
		mode = existingMode
	default:
		mode = ModeFollowUp
	}
	if checkSet {
		if check < 120 || check > 4320 {
			return "", false, 0, ErrInvalidPolicy
		}
	} else if existingCheck >= 120 && existingCheck <= 4320 {
		check = existingCheck
	} else {
		check = 720
	}
	return mode, mode != ModeOff, check, nil
}
