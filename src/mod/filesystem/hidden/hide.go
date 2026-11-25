package hidden

import (
	"os"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

func hide(filename string) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/hidden", "hide: filename=%.120q", filename)
	}
	if !strings.HasPrefix(filepath.Base(filename), ".") {
		err := os.Rename(filename, "."+filename)
		if err != nil {
			return err
		}
	}
	return nil
}

func isHidden(filename string) (bool, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/hidden", "isHidden: filename=%.120q", filename)
	}
	if len(filepath.Base(filename)) > 0 && filepath.Base(filename)[0:1] == "." {
		return true, nil
	}

	return false, nil
}
