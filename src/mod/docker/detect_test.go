package docker

import (
	"os/exec"
	"testing"
)

// dockerCLIAvailable reports whether the docker binary is on PATH in the test
// environment. CI hosts generally do not have docker installed, so any test
// that needs the daemon must skip when this is false (same guard convention as
// mod/disk/diskmg's tests).
func dockerCLIAvailable() bool {
	_, err := exec.LookPath("docker")
	return err == nil
}

// TestDetectDockerCLI asserts the detection result matches the host reality:
// it must error iff the docker binary is absent.
func TestDetectDockerCLI(t *testing.T) {
	err := detectDockerCLI()
	if dockerCLIAvailable() {
		if err != nil {
			t.Errorf("detectDockerCLI() returned error with docker present: %v", err)
		}
	} else {
		if err == nil {
			t.Error("detectDockerCLI() returned nil with docker absent, want error")
		}
	}
}

// TestDetectDockerEngine only asserts the contract when docker is present, since
// the daemon may or may not be running on the host. When docker is absent it
// must return an error (the runDocker exec itself fails).
func TestDetectDockerEngine(t *testing.T) {
	if !dockerCLIAvailable() {
		_, err := detectDockerEngine()
		if err == nil {
			t.Error("detectDockerEngine() returned nil with docker absent, want error")
		}
		return
	}

	version, err := detectDockerEngine()
	if err != nil {
		// Daemon present-but-unreachable is a legitimate host state, not a test
		// failure — just confirm the error path returns an empty version.
		if version != "" {
			t.Errorf("detectDockerEngine() error path returned version %q, want empty", version)
		}
		t.Skipf("docker daemon not reachable on this host: %v", err)
	}

	if version == "" {
		t.Error("detectDockerEngine() succeeded but returned an empty server version")
	}
}
