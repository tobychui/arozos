package static

import "testing"

// RunCleanup is the guarded entry point libraries use to register a teardown
// closure. It must forward to RegisterCleanup when one is present and stay
// silent — never panic — in every configuration where one is not, because
// payloads built outside a script execution context (init.agi injection, tests)
// legitimately carry no cleanup registry.
func TestRunCleanup(t *testing.T) {
	tests := []struct {
		name        string
		nilPayload  bool
		hasRegistry bool
		nilCleanup  bool
		wantCalls   int
	}{
		{name: "forwards to registry", hasRegistry: true, wantCalls: 1},
		{name: "no registry is a no-op", hasRegistry: false, wantCalls: 0},
		{name: "nil cleanup is not registered", hasRegistry: true, nilCleanup: true, wantCalls: 0},
		{name: "nil payload is a no-op", nilPayload: true, wantCalls: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			registered := 0

			var payload *AgiLibInjectionPayload
			if !tt.nilPayload {
				payload = &AgiLibInjectionPayload{}
				if tt.hasRegistry {
					payload.RegisterCleanup = func(func()) { registered++ }
				}
			}

			cleanup := func() {}
			if tt.nilCleanup {
				cleanup = nil
			}

			defer func() {
				if caught := recover(); caught != nil {
					t.Fatalf("RunCleanup panicked: %v", caught)
				}
			}()
			payload.RunCleanup(cleanup)

			if registered != tt.wantCalls {
				t.Errorf("expected %d registration(s), got %d", tt.wantCalls, registered)
			}
		})
	}
}

// The closure handed to RunCleanup must reach the registry unchanged, so the
// runtime executes exactly the teardown the library intended.
func TestRunCleanup_PassesClosureThrough(t *testing.T) {
	var captured func()
	payload := &AgiLibInjectionPayload{
		RegisterCleanup: func(cleanup func()) { captured = cleanup },
	}

	ran := false
	payload.RunCleanup(func() { ran = true })

	if captured == nil {
		t.Fatal("expected the cleanup closure to reach the registry")
	}
	captured()
	if !ran {
		t.Error("the registered closure was not the one passed to RunCleanup")
	}
}
