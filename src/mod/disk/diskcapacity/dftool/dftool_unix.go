//go:build !windows

package dftool

import "imuslab.com/arozos/mod/info/logger"
import "os/exec"

// capacityOf asks df about the disk holding an absolute path. -k fixes the
// block at 1024 bytes: without it macOS counts 512 byte blocks, and every
// size came out doubled.
func capacityOf(rpathAbs string) (out0 *Capacity, out1 error) {
	defer logger.Out2(logger.In1("disk/diskcapacity/dftool", "capacityOf", "rpathAbs", rpathAbs), &out0, &out1)
	out, err := exec.Command("df", "-kP", rpathAbs).CombinedOutput()
	if err != nil {
		logger.DebugErr("disk/diskcapacity/dftool", err)
		return nil, err
	}
	return parseDFOutput(string(out))
}
