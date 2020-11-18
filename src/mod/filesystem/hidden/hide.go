// +build !windows

package hidden

import (
	"os"
	"path/filepath"
	"strings"
)

func hide(filename string) error {
	if !strings.HasPrefix(filepath.Base(filename), ".") {
		err := os.Rename(filename, "."+filename)
		if err != nil {
			return err
		}
	}
	return nil
}
