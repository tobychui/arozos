package smart

import (
	"fmt"
	"os/exec"

	"imuslab.com/arozos/mod/info/logger"
)

func execCommand(executable string, args ...string) (out0 string) {
	defer logger.Out1(logger.In2("disk/smart", "execCommand", "executable", executable, "args", args), &out0)
	shell := exec.Command(executable, args...) // Run command
	output, err := shell.CombinedOutput()      // Response from cmdline
	if err != nil && string(output) == "" {    // If done w/ errors then
		logger.PrintAndLog("Smart", fmt.Sprint(err), nil)
		return ""
	}

	return string(output)
}
