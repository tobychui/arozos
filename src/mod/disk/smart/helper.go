package smart

import (
	"fmt"
	"os/exec"

	"imuslab.com/arozos/mod/info/logger"
)

func execCommand(executable string, args ...string) string {
	if logger.IsDebug() {
		logger.Debugf("disk/smart", "execCommand: executable=%.120q len(args)=%d", executable, len(args))
	}
	shell := exec.Command(executable, args...) // Run command
	output, err := shell.CombinedOutput()      // Response from cmdline
	if err != nil && string(output) == "" {    // If done w/ errors then
		logger.PrintAndLog("Smart", fmt.Sprint(err), nil)
		return ""
	}

	return string(output)
}
