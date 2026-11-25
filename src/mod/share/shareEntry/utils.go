package shareEntry

import "imuslab.com/arozos/mod/info/logger"

func stringInSlice(e string, s []string) bool {
	if logger.IsDebug() {
		logger.Debugf("share/shareEntry", "stringInSlice: e=%.120q len(s)=%d", e, len(s))
	}
	for _, a := range s {
		if a == e {
			return true
		}
	}
	return false
}
