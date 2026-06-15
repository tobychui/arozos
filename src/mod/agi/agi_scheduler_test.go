package agi

import (
	"errors"
	"testing"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	user "imuslab.com/arozos/mod/user"
)

// ─── helpers ─────────────────────────────────────────────────────────────────

// minimalGateway returns a Gateway with only the fields needed by the scheduler tests.
func minimalGateway() *Gateway {
	return &Gateway{
		ReservedTables:   []string{},
		NightlyScripts:   []string{},
		LoadedAGILibrary: map[string]AgiLibInjectionIntergface{},
		Option:           &AgiSysInfo{},
	}
}

// stubUser returns a bare *user.User with just a Username set.
// It does not require a full UserHandler or DB.
func stubUser(name string) *user.User {
	return &user.User{Username: name}
}

// stubCallbacks returns a SchedulerCallbacks with all fields populated by
// simple in-memory state, so we can assert calls were made.
func stubCallbacks(registered map[string]bool, canCreate bool) *SchedulerCallbacks {
	return &SchedulerCallbacks{
		RegisterJob: func(creator, appName, taskName, scriptVpath, fshID, description string, interval, baseTime int64) error {
			key := appName + "/" + creator + "/" + taskName
			if registered[key] {
				return errors.New("already registered")
			}
			registered[key] = true
			return nil
		},
		UnregisterJob: func(creator, taskName string) error {
			for k := range registered {
				if k[len(k)-len(taskName):] == taskName {
					delete(registered, k)
					return nil
				}
			}
			return errors.New("job not found")
		},
		AppJobExists: func(appName, creator, taskName string) bool {
			return registered[appName+"/"+creator+"/"+taskName]
		},
		CanCreate: func(username string) bool {
			return canCreate
		},
	}
}

// ─── RegisterSchedulerLib ────────────────────────────────────────────────────

func TestRegisterSchedulerLib_AddsToLoadedLibs(t *testing.T) {
	g := minimalGateway()
	cb := &SchedulerCallbacks{}
	g.RegisterSchedulerLib(cb)

	if _, ok := g.LoadedAGILibrary["scheduler"]; !ok {
		t.Error("expected 'scheduler' in LoadedAGILibrary after RegisterSchedulerLib")
	}
}

func TestRegisterSchedulerLib_IdempotentDoesNotPanic(t *testing.T) {
	g := minimalGateway()
	cb := &SchedulerCallbacks{}
	// Second call should log but not panic
	g.RegisterSchedulerLib(cb)
	g.RegisterSchedulerLib(cb) // should just log a warning
}

// ─── SchedulerCallbacks nil-safety ───────────────────────────────────────────

func TestInjectSchedulerLib_NilCallbacksNoHasPermission(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{
		VM:   vm,
		User: stubUser("alice"),
	}
	// Should not panic when callbacks is nil
	g.injectSchedulerLibFunctions(payload, nil)

	val, err := vm.Run(`_scheduler_hasPermission()`)
	if err != nil {
		t.Fatalf("hasPermission() errored: %v", err)
	}
	b, _ := val.ToBoolean()
	if b {
		t.Error("expected false for nil callbacks, got true")
	}
}

func TestInjectSchedulerLib_NilCallbacksNoRegistered(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	payload := &static.AgiLibInjectionPayload{
		VM:   vm,
		User: stubUser("alice"),
	}
	g.injectSchedulerLibFunctions(payload, nil)

	val, err := vm.Run(`_scheduler_registered("MyTask", "MyApp")`)
	if err != nil {
		t.Fatalf("registered() errored: %v", err)
	}
	b, _ := val.ToBoolean()
	if b {
		t.Error("expected false for nil callbacks, got true")
	}
}

// ─── hasPermission ───────────────────────────────────────────────────────────

func TestInjectSchedulerLib_HasPermissionTrue(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	cb := stubCallbacks(map[string]bool{}, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	val, _ := vm.Run(`_scheduler_hasPermission()`)
	b, _ := val.ToBoolean()
	if !b {
		t.Error("expected hasPermission() true for user with permission")
	}
}

func TestInjectSchedulerLib_HasPermissionFalse(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	cb := stubCallbacks(map[string]bool{}, false)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("bob")}
	g.injectSchedulerLibFunctions(payload, cb)

	val, _ := vm.Run(`_scheduler_hasPermission()`)
	b, _ := val.ToBoolean()
	if b {
		t.Error("expected hasPermission() false for user without permission")
	}
}

// ─── registered ──────────────────────────────────────────────────────────────

func TestInjectSchedulerLib_RegisteredFalseInitially(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	jobs := map[string]bool{}
	cb := stubCallbacks(jobs, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	val, _ := vm.Run(`_scheduler_registered("MyTask", "MyApp")`)
	b, _ := val.ToBoolean()
	if b {
		t.Error("expected registered() false before any registration")
	}
}

func TestInjectSchedulerLib_RegisteredTrueAfterRegister(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	jobs := map[string]bool{}
	cb := stubCallbacks(jobs, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	// Manually mark as registered in the stub
	jobs["MyApp/alice/MyTask"] = true

	val, _ := vm.Run(`_scheduler_registered("MyTask", "MyApp")`)
	b, _ := val.ToBoolean()
	if !b {
		t.Error("expected registered() true after job was added to the stub")
	}
}

// ─── register ────────────────────────────────────────────────────────────────

func TestInjectSchedulerLib_RegisterReturnsTrue(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	jobs := map[string]bool{}
	cb := stubCallbacks(jobs, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	_, err := vm.Run(`var ok = _scheduler_register("DailyTask", "MyApp", 86400, "desc", "cron.agi");`)
	if err != nil {
		t.Fatalf("register() error: %v", err)
	}
	val, _ := vm.Get("ok")
	b, _ := val.ToBoolean()
	if !b {
		t.Error("expected register() to return true on first registration")
	}
	if !jobs["MyApp/alice/DailyTask"] {
		t.Error("expected stub jobs map to contain MyApp/alice/DailyTask")
	}
}

func TestInjectSchedulerLib_RegisterReturnsFalseOnDuplicate(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	jobs := map[string]bool{}
	cb := stubCallbacks(jobs, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	vm.Run(`_scheduler_register("DailyTask", "MyApp", 86400, "desc", "cron.agi")`)
	_, err := vm.Run(`var ok2 = _scheduler_register("DailyTask", "MyApp", 86400, "desc", "cron.agi");`)
	if err != nil {
		// otto may surface a raised error — acceptable; the return value test is redundant
		return
	}
	val, _ := vm.Get("ok2")
	b, _ := val.ToBoolean()
	if b {
		t.Error("expected register() to return false on duplicate registration")
	}
}

func TestInjectSchedulerLib_RegisterMissingAppNameReturnsFalse(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	cb := stubCallbacks(map[string]bool{}, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	_, err := vm.Run(`var ok = _scheduler_register("task", "", 60, "", "cron.agi");`)
	if err != nil {
		return // raised error is also acceptable
	}
	val, _ := vm.Get("ok")
	b, _ := val.ToBoolean()
	if b {
		t.Error("expected register() to return false when appName is empty")
	}
}

// ─── unregister ──────────────────────────────────────────────────────────────

func TestInjectSchedulerLib_UnregisterRemovesJob(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	jobs := map[string]bool{"MyApp/alice/DailyTask": true}
	cb := stubCallbacks(jobs, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	_, err := vm.Run(`var ok = _scheduler_unregister("DailyTask");`)
	if err != nil {
		t.Fatalf("unregister() error: %v", err)
	}
	val, _ := vm.Get("ok")
	b, _ := val.ToBoolean()
	if !b {
		t.Error("expected unregister() to return true for existing job")
	}
	if jobs["MyApp/alice/DailyTask"] {
		t.Error("expected job to be removed from stub after unregister")
	}
}

func TestInjectSchedulerLib_UnregisterNonExistentReturnsFalse(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	cb := stubCallbacks(map[string]bool{}, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	_, err := vm.Run(`var ok = _scheduler_unregister("Ghost");`)
	if err != nil {
		return // raised error acceptable
	}
	val, _ := vm.Get("ok")
	b, _ := val.ToBoolean()
	if b {
		t.Error("expected unregister() to return false for non-existent job")
	}
}

// ─── JS scheduler object ─────────────────────────────────────────────────────

func TestInjectSchedulerLib_JSObjectExposed(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	cb := stubCallbacks(map[string]bool{}, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	for _, method := range []string{"hasPermission", "registered", "register", "unregister"} {
		val, err := vm.Run(`typeof scheduler.` + method)
		if err != nil {
			t.Fatalf("evaluating scheduler.%s: %v", method, err)
		}
		s, _ := val.ToString()
		if s != "function" {
			t.Errorf("scheduler.%s should be a function, got %q", method, s)
		}
	}
}

func TestInjectSchedulerLib_JSObjectHasPermission(t *testing.T) {
	g := minimalGateway()
	vm := otto.New()
	cb := stubCallbacks(map[string]bool{}, true)
	payload := &static.AgiLibInjectionPayload{VM: vm, User: stubUser("alice")}
	g.injectSchedulerLibFunctions(payload, cb)

	val, err := vm.Run(`scheduler.hasPermission()`)
	if err != nil {
		t.Fatalf("scheduler.hasPermission(): %v", err)
	}
	b, _ := val.ToBoolean()
	if !b {
		t.Error("scheduler.hasPermission() should return true for permitted user")
	}
}
