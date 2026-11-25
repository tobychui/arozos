package utils

import "imuslab.com/arozos/mod/info/logger"
import "strconv"

func StringToInt64(number string) (out0 int64, out1 error) {
	defer logger.Out2(logger.In1("utils", "StringToInt64", "number", number), &out0, &out1)
	i, err := strconv.ParseInt(number, 10, 64)
	if err != nil {
		logger.DebugErr("utils", err)
		return -1, err
	}
	return i, nil
}

func Int64ToString(number int64) (out0 string) {
	defer logger.Out1(logger.In1("utils", "Int64ToString", "number", number), &out0)
	convedNumber := strconv.FormatInt(number, 10)
	return convedNumber
}
