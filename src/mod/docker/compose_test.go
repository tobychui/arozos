package docker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateStackName(t *testing.T) {
	tests := []struct {
		name    string
		stack   string
		wantErr bool
	}{
		{"empty", "", true},
		{"simple", "mystack", false},
		{"dash underscore", "my-stack_1", false},
		{"traversal", "../etc", true},
		{"slash", "a/b", true},
		{"space", "my stack", true},
		{"dot", "stack.1", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateStackName(tt.stack); (err != nil) != tt.wantErr {
				t.Errorf("validateStackName(%q) err=%v, wantErr=%v", tt.stack, err, tt.wantErr)
			}
		})
	}
}

// newFsManager builds a manager wired only to a base dir, with compose marked
// unavailable so filesystem-only operations are testable without a docker host.
func newFsManager(baseDir string) *DockerManager {
	return &DockerManager{
		Options:          &Options{StackBaseDir: baseDir},
		composeAvailable: false,
	}
}

func TestListStacksAndDisable(t *testing.T) {
	base := t.TempDir()
	dm := newFsManager(base)

	// Stack "alpha": valid compose file, not disabled.
	alpha := filepath.Join(base, "alpha")
	os.MkdirAll(alpha, 0755)
	os.WriteFile(filepath.Join(alpha, composeFileName), []byte("services: {}"), 0644)

	// Stack "beta": valid compose file + .disabled marker.
	beta := filepath.Join(base, "beta")
	os.MkdirAll(beta, 0755)
	os.WriteFile(filepath.Join(beta, composeFileName), []byte("services: {}"), 0644)
	os.WriteFile(filepath.Join(beta, disabledMarker), []byte(""), 0644)

	// Directory with no compose file should be ignored.
	os.MkdirAll(filepath.Join(base, "notastack"), 0755)

	stacks, err := dm.ListStacks()
	if err != nil {
		t.Fatalf("ListStacks() error: %v", err)
	}
	if len(stacks) != 2 {
		t.Fatalf("ListStacks() returned %d stacks, want 2: %+v", len(stacks), stacks)
	}

	byName := map[string]StackInfo{}
	for _, s := range stacks {
		byName[s.Name] = s
	}
	if byName["alpha"].Disabled {
		t.Error("alpha should not be disabled")
	}
	if !byName["beta"].Disabled {
		t.Error("beta should be disabled")
	}

	// Toggle disable on alpha and confirm the marker appears.
	if err := dm.SetStackDisabled("alpha", true); err != nil {
		t.Fatalf("SetStackDisabled(true) error: %v", err)
	}
	if !fileExists(filepath.Join(alpha, disabledMarker)) {
		t.Error("alpha .disabled marker not created")
	}
	// Re-enable and confirm the marker is gone.
	if err := dm.SetStackDisabled("alpha", false); err != nil {
		t.Fatalf("SetStackDisabled(false) error: %v", err)
	}
	if fileExists(filepath.Join(alpha, disabledMarker)) {
		t.Error("alpha .disabled marker not removed")
	}
}

func TestGetStackYAML(t *testing.T) {
	base := t.TempDir()
	dm := newFsManager(base)
	dir := filepath.Join(base, "web")
	os.MkdirAll(dir, 0755)
	os.WriteFile(filepath.Join(dir, composeFileName), []byte("services:\n  web:\n    image: nginx"), 0644)

	content, err := dm.GetStackYAML("web")
	if err != nil {
		t.Fatalf("GetStackYAML() error: %v", err)
	}
	if content == "" || content[:8] != "services" {
		t.Errorf("unexpected content: %q", content)
	}

	if _, err := dm.GetStackYAML("nope"); err == nil {
		t.Error("GetStackYAML(nope) expected error for missing stack")
	}
	if _, err := dm.GetStackYAML("../escape"); err == nil {
		t.Error("GetStackYAML with traversal name should error")
	}
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
