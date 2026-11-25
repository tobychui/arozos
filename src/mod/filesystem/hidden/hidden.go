package hidden

import (
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Arozos hidden module
	author: tobychui

	No, the name didn't mean you can't find this module
	Yes, this is actually a module that use to hide files

*/

// Hide a given folder
func HideFile(folderpath string) (out0 error) {
	defer logger.Out1(logger.In1("filesystem/hidden", "HideFile", "folderpath", folderpath), &out0)
	return hide(folderpath)
}

// Check if a given file is hidden. Set recursive to true if you want to check if the file located inside a hidden folder
func IsHidden(filename string, recursive bool) (out0 bool, out1 error) {
	defer logger.Out2(logger.In2("filesystem/hidden", "IsHidden", "filename", filename, "recursive", recursive), &out0, &out1)
	if recursive {
		filename = filepath.ToSlash(filename)
		chunks := strings.Split(filename, "/")
		for _, chunk := range chunks {
			if strings.TrimSpace(chunk) == "" {
				//Empty chunk. Skip this
				continue
			}
			hiddenState, _ := isHidden(strings.TrimSpace(chunk))
			if hiddenState {
				return true, nil
			}
		}
		return false, nil
	} else {
		return isHidden(filename)
	}

}
