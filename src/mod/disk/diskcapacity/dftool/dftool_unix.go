//go:build !windows

package dftool

import "os/exec"

// capacityOf asks df about the disk holding an absolute path. -k fixes the
// block at 1024 bytes: without it macOS counts 512 byte blocks, and every
// size came out doubled.
func capacityOf(rpathAbs string) (*Capacity, error) {
	out, err := exec.Command("df", "-kP", rpathAbs).CombinedOutput()
	if err != nil {
		return nil, err
	}
	return parseDFOutput(string(out))
}
