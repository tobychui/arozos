package hidden

import (
	"os"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

func hide(filename string) (out0 error) {
	defer logger.Out1(logger.In1("filesystem/hidden", "hide", "filename", filename), &out0)
	if !strings.HasPrefix(filepath.Base(filename), ".") {
		err := os.Rename(filename, "."+filename)
		if err != nil {
			logger.DebugErr("filesystem/hidden", err)
			return err
		}
	}
	return nil
}

func isHidden(filename string) (out0 bool, out1 error) {
	defer logger.Out2(logger.In1("filesystem/hidden", "isHidden", "filename", filename), &out0, &out1)
	if len(filepath.Base(filename)) > 0 && filepath.Base(filename)[0:1] == "." {
		return true, nil
	}

	return false, nil
}
