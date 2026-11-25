package utils

import "imuslab.com/arozos/mod/info/logger"
import "strconv"

func StringToInt64(number string) (int64, error) {
	if logger.IsDebug() {
		logger.Debugf("utils", "StringToInt64: number=%.120q", number)
	}
	i, err := strconv.ParseInt(number, 10, 64)
	if err != nil {
		return -1, err
	}
	return i, nil
}

func Int64ToString(number int64) string {
	if logger.IsDebug() {
		logger.Debugf("utils", "Int64ToString: number=%d", number)
	}
	convedNumber := strconv.FormatInt(number, 10)
	return convedNumber
}
