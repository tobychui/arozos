package agi

import (
	"fmt"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	AGI Scheduler Library
	author: tobychui

	Exposes task scheduler functionality to AGI scripts via the "scheduler" library.
	Load it with:  requirelib("scheduler");

	The cron script (cron.agi by default) must live inside the webapp's own folder,
	next to init.agi — NOT in user virtual storage:

	    ./web/MyApp/
	        init.agi
	        cron.agi       ← this is what gets scheduled
	        index.html

	Usage pattern (typically placed in a backend AGI called on first launch):

	    requirelib("scheduler");

	    var APP  = "MyApp";          // must match your module folder name
	    var TASK = "MyApp_DailySync";

	    if (!scheduler.hasPermission()) {
	        // The frontend should call ao_module_requestSchedulerPermission()
	        // to ask the user to grant this permission first.
	        sendResp("no_permission");
	    } else if (scheduler.registered(TASK, APP)) {
	        sendResp("already_registered");
	    } else {
	        // scriptName defaults to "cron.agi" if omitted
	        var ok = scheduler.register(TASK, APP, 86400, "Daily sync", "cron.agi");
	        sendResp(ok ? "registered" : "error");
	    }

	    // To unregister (e.g. on user opt-out):
	    scheduler.unregister(TASK);
*/

// SchedulerCallbacks holds function pointers to the scheduler's core operations.
// This avoids a circular import between the agi and scheduler packages.
type SchedulerCallbacks struct {
	// RegisterJob registers a new job; returns error string or ""
	RegisterJob func(creator, appName, taskName, scriptVpath, fshID, description string, interval, baseTime int64) error
	// UnregisterJob removes a job by name for the given creator (or admin)
	UnregisterJob func(creator, taskName string) error
	// JobExists checks whether a job with the given appName+creator+taskName is registered
	AppJobExists func(appName, creator, taskName string) bool
	// CanCreate checks whether the given username has cron creation permission
	CanCreate func(username string) bool
}

// RegisterSchedulerLib registers the AGI "scheduler" library after the scheduler is running.
// Must be called after the Scheduler is initialized, passing callback functions
// so that the agi package does not import the scheduler package directly.
func (g *Gateway) RegisterSchedulerLib(callbacks *SchedulerCallbacks) {
	err := g.RegisterLib("scheduler", func(payload *static.AgiLibInjectionPayload) {
		g.injectSchedulerLibFunctions(payload, callbacks)
	})
	if err != nil {
		// Library already registered – not fatal, just warn
		logger.PrintAndLog("Agi", fmt.Sprint("[AGI] scheduler lib already registered:", err), nil)
	}
}

func (g *Gateway) injectSchedulerLibFunctions(payload *static.AgiLibInjectionPayload, cb *SchedulerCallbacks) {
	vm := payload.VM
	u := payload.User

	/*
		scheduler.hasPermission() => bool
		Returns true when the current user is allowed to create cron jobs.
	*/
	vm.Set("_scheduler_hasPermission", func(call otto.FunctionCall) otto.Value {
		if cb == nil || cb.CanCreate == nil {
			return otto.FalseValue()
		}
		canCreate := cb.CanCreate(u.Username)
		if canCreate {
			return otto.TrueValue()
		}
		return otto.FalseValue()
	})

	/*
		scheduler.registered(taskName) => bool
		Returns true when the task with the given name is already registered for this user+app.
	*/
	vm.Set("_scheduler_registered", func(call otto.FunctionCall) otto.Value {
		taskName, err := call.Argument(0).ToString()
		if err != nil || taskName == "undefined" {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		appName, err := call.Argument(1).ToString()
		if err != nil || appName == "undefined" {
			appName = ""
		}
		if cb == nil || cb.AppJobExists == nil {
			return otto.FalseValue()
		}
		exists := cb.AppJobExists(appName, u.Username, taskName)
		if exists {
			return otto.TrueValue()
		}
		return otto.FalseValue()
	})

	/*
		scheduler.register(taskName, appName, intervalSecs, description, scriptName) => bool
		Registers a cron job for the calling app's own cron script.
		- taskName:    unique name for the job (max 32 chars)
		- appName:     the webapp's module folder name (must match the folder in ./web/)
		- intervalSecs: execution interval in seconds
		- description: optional human-readable description
		- scriptName:  script filename inside the app folder, default "cron.agi"
		Returns true on success, false on error.
	*/
	vm.Set("_scheduler_register", func(call otto.FunctionCall) otto.Value {
		taskName, err := call.Argument(0).ToString()
		if err != nil || taskName == "undefined" {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		appName, err := call.Argument(1).ToString()
		if err != nil || appName == "undefined" || appName == "" {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		intervalSecs, err := call.Argument(2).ToInteger()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		description, _ := call.Argument(3).ToString()
		if description == "undefined" {
			description = ""
		}
		scriptName, _ := call.Argument(4).ToString()
		if scriptName == "undefined" || scriptName == "" {
			scriptName = "cron.agi"
		}

		if cb == nil || cb.RegisterJob == nil {
			g.RaiseError(errExitcall)
			return otto.FalseValue()
		}

		baseTime := time.Now().Unix()
		// scriptName is app-relative ("cron.agi") — RegisterJobFromAGI detects this
		// because it has no ":" separator and appName is set.
		regErr := cb.RegisterJob(u.Username, appName, taskName, scriptName, "", description, intervalSecs, baseTime)
		if regErr != nil {
			g.RaiseError(regErr)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	/*
		scheduler.unregister(taskName, appName) => bool
		Removes a previously registered cron job.
		Returns true on success, false on error.
	*/
	vm.Set("_scheduler_unregister", func(call otto.FunctionCall) otto.Value {
		taskName, err := call.Argument(0).ToString()
		if err != nil || taskName == "undefined" {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		if cb == nil || cb.UnregisterJob == nil {
			g.RaiseError(errExitcall)
			return otto.FalseValue()
		}
		unregErr := cb.UnregisterJob(u.Username, taskName)
		if unregErr != nil {
			g.RaiseError(unregErr)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	// Expose as a "scheduler" object in the JS vm
	vm.Run(`
		var scheduler = {
			hasPermission: function() {
				return _scheduler_hasPermission();
			},
			registered: function(taskName, appName) {
				appName = appName || "";
				return _scheduler_registered(taskName, appName);
			},
			// register(taskName, appName, intervalSecs [, description [, scriptName]])
			// scriptName defaults to "cron.agi" inside the app's own folder.
			register: function(taskName, appName, intervalSecs, description, scriptName) {
				description = description || "";
				scriptName  = scriptName  || "cron.agi";
				return _scheduler_register(taskName, appName, intervalSecs, description, scriptName);
			},
			unregister: function(taskName) {
				return _scheduler_unregister(taskName);
			}
		};
	`)
}
