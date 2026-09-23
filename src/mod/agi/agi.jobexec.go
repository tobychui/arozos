package agi

/*
	Job execution entry point.

	ExecuteJobScript is like ExecuteAGIScript but lets the caller inject extra
	functions into the VM before the script runs (the cluster job runtime uses
	it for the job object) and hands back the interrupt channel so a running
	job can be stopped on timeout or cancellation.
*/

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
)

// JobStopper interrupts a running job script.
type JobStopper struct {
	interrupt chan func()
}

// Stop asks the VM to unwind at the next statement.
func (s *JobStopper) Stop() {
	if s == nil || s.interrupt == nil {
		return
	}
	select {
	case s.interrupt <- func() { panic(errJobStopped) }:
	default:
	}
}

var errJobStopped = errors.New("job stopped")

// ExecuteJobScript runs scriptContent as thisuser with extra functions
// injected. It returns any script error. onStart receives a stopper as soon
// as the VM exists, so the caller can interrupt a long running job.
func (g *Gateway) ExecuteJobScript(scriptContent string, scriptName string, thisuser *user.User, w http.ResponseWriter, r *http.Request, inject func(*otto.Otto), onStart func(*JobStopper)) (err error) {
	vm := otto.New()
	vm.Interrupt = make(chan func(), 1)
	execID := g.injectStandardLibs(vm, scriptName, "")
	releaseLibResources := g.injectUserFunctions(vm, nil, scriptName, "", thisuser, w, r)
	if r != nil {
		g.injectServerlessFunctions(vm, scriptName, "", thisuser, r)
	}
	if inject != nil {
		inject(vm)
	}

	username := ""
	if thisuser != nil {
		username = thisuser.Username
	}
	g.vmReg.register(&VMRecord{
		ExecID:      execID,
		ScriptFile:  scriptName,
		Username:    username,
		StartTime:   time.Now(),
		interruptCh: vm.Interrupt,
	})
	if onStart != nil {
		onStart(&JobStopper{interrupt: vm.Interrupt})
	}

	defer func() {
		g.vmReg.unregister(execID)
		releaseLibResources()
		if caught := recover(); caught != nil {
			switch caught {
			case errTimeout:
				err = errors.New("job script execution timeout")
			case errExitcall:
				err = nil
			case errJobStopped:
				err = errors.New("job stopped")
			default:
				err = fmt.Errorf("%v", caught)
				logger.PrintAndLog("Agi", fmt.Sprint("Job script error: ", caught), nil)
			}
		}
	}()

	_, runErr := vm.Run(scriptContent)
	if runErr != nil {
		return runErr
	}
	return nil
}
