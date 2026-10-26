package docker

import "testing"

func TestValidServiceActions(t *testing.T) {
	valid := []string{"start", "stop", "restart", "enable", "disable"}
	for _, a := range valid {
		if !validServiceActions[a] {
			t.Errorf("action %q should be valid", a)
		}
	}
	invalid := []string{"", "status", "kill", "reload", "rm", "start docker"}
	for _, a := range invalid {
		if validServiceActions[a] {
			t.Errorf("action %q should be invalid", a)
		}
	}
}

// TestDockerServiceStatusConsistent asserts the status object is internally
// consistent on whatever platform the test runs on: when service control is
// unavailable there must be an explanatory message and the daemon must not be
// reported active.
func TestDockerServiceStatusConsistent(t *testing.T) {
	st := dockerServiceStatus()
	if !st.Available {
		if st.Message == "" {
			t.Error("unavailable service status must carry an explanatory message")
		}
		if st.Active {
			t.Error("service reported active while unavailable")
		}
	}
}
