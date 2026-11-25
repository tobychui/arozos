package shareEntry

import "imuslab.com/arozos/mod/info/logger"

func stringInSlice(e string, s []string) (out0 bool) {
	defer logger.Out1(logger.In2("share/shareEntry", "stringInSlice", "e", e, "s", s), &out0)
	for _, a := range s {
		if a == e {
			return true
		}
	}
	return false
}
