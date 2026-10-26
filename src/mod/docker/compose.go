package docker

/*
	compose.go

	Docker Compose stack management. Stacks live on disk under StackBaseDir:

	    ./system/docker/stacks/<stackName>/docker-compose.yml
	    ./system/docker/stacks/<stackName>/.disabled   (optional marker)

	The .disabled marker mirrors the subservice convention: AutoStartStacks
	(run at boot) brings up every stack WITHOUT a .disabled marker, exactly like
	SubserviceInit scans ./subservice/* and skips .disabled.

	A compose file's volume bind paths are real host paths resolved by the Docker
	daemon, outside ArozOS's virtual filesystem — by design (an admin deploying a
	stack already has host-level reach). We validate the YAML with
	`docker compose config` before persisting but deliberately do not rewrite or
	sandbox host volume paths.
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// stackNameRegex restricts a stack name to a path-safe, compose-project-safe set.
var stackNameRegex = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

const composeFileName = "docker-compose.yml"
const disabledMarker = ".disabled"

// StackInfo describes one on-disk compose stack.
type StackInfo struct {
	Name     string `json:"name"`
	Disabled bool   `json:"disabled"` // .disabled marker present (won't auto-start)
	Running  bool   `json:"running"`  // best-effort: has running containers
}

// composeSaveRequest is the JSON body for saving a stack.
type composeSaveRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func validateStackName(name string) error {
	if name == "" {
		return errors.New("empty stack name")
	}
	if !stackNameRegex.MatchString(name) {
		return errors.New("invalid stack name (use letters, digits, dash, underscore)")
	}
	return nil
}

func (d *DockerManager) stackDir(name string) string {
	return filepath.Join(d.Options.StackBaseDir, name)
}

func (d *DockerManager) composeFilePath(name string) string {
	return filepath.Join(d.stackDir(name), composeFileName)
}

// requireCompose returns an error when the compose v2 plugin is unavailable.
func (d *DockerManager) requireCompose() error {
	if !d.composeAvailable {
		return errors.New("docker compose v2 plugin is not available on this host")
	}
	return nil
}

// ListStacks enumerates stacks under StackBaseDir.
func (d *DockerManager) ListStacks() ([]StackInfo, error) {
	results := []StackInfo{}
	entries, err := filepath.Glob(filepath.Join(d.Options.StackBaseDir, "*"))
	if err != nil {
		return results, err
	}
	for _, dir := range entries {
		if !utils.IsDir(dir) {
			continue
		}
		name := filepath.Base(dir)
		if !utils.FileExists(filepath.Join(dir, composeFileName)) {
			continue
		}
		info := StackInfo{
			Name:     name,
			Disabled: utils.FileExists(filepath.Join(dir, disabledMarker)),
			Running:  d.stackHasRunning(name),
		}
		results = append(results, info)
	}
	return results, nil
}

// stackHasRunning is a best-effort check for whether a stack has live containers.
func (d *DockerManager) stackHasRunning(name string) bool {
	if d.requireCompose() != nil {
		return false
	}
	out, err := runDocker("compose", "-p", name, "-f", d.composeFilePath(name), "ps", "-q")
	if err != nil {
		return false
	}
	return len(out) > 0
}

// GetStackYAML returns the raw compose file content for a stack.
func (d *DockerManager) GetStackYAML(name string) (string, error) {
	if err := validateStackName(name); err != nil {
		return "", err
	}
	data, err := os.ReadFile(d.composeFilePath(name))
	if err != nil {
		return "", errors.New("stack not found")
	}
	return string(data), nil
}

// SaveStack validates the YAML with `docker compose config` and, only if valid,
// writes it to disk. Validation runs against a temp file inside the stack dir so
// relative paths / env files resolve the same way they will at deploy time.
func (d *DockerManager) SaveStack(name, content string) error {
	if err := d.requireCompose(); err != nil {
		return err
	}
	if err := validateStackName(name); err != nil {
		return err
	}
	if content == "" {
		return errors.New("empty compose file")
	}

	dir := d.stackDir(name)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmpPath := filepath.Join(dir, ".docker-compose.yml.tmp")
	if err := os.WriteFile(tmpPath, []byte(content), 0644); err != nil {
		return err
	}

	//Validate. `config -q` exits non-zero with a descriptive stderr on bad YAML.
	if _, err := runDocker("compose", "-f", tmpPath, "config", "-q"); err != nil {
		os.Remove(tmpPath)
		return errors.New("invalid compose file: " + err.Error())
	}

	//Atomically replace the live file with the validated temp file.
	if err := os.Rename(tmpPath, d.composeFilePath(name)); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return nil
}

// DeployStack brings a stack up in detached mode.
func (d *DockerManager) DeployStack(name string) error {
	if err := d.requireCompose(); err != nil {
		return err
	}
	if err := validateStackName(name); err != nil {
		return err
	}
	if !utils.FileExists(d.composeFilePath(name)) {
		return errors.New("stack not found")
	}
	_, err := runDocker("compose", "-p", name, "-f", d.composeFilePath(name), "up", "-d")
	return err
}

// DownStack stops and removes a stack's containers (keeps the compose file).
func (d *DockerManager) DownStack(name string) error {
	if err := d.requireCompose(); err != nil {
		return err
	}
	if err := validateStackName(name); err != nil {
		return err
	}
	_, err := runDocker("compose", "-p", name, "-f", d.composeFilePath(name), "down")
	return err
}

// DeleteStack brings the stack down and removes its directory entirely.
func (d *DockerManager) DeleteStack(name string) error {
	if err := validateStackName(name); err != nil {
		return err
	}
	//Best-effort down (ignore error: the stack may already be stopped).
	if d.composeAvailable && utils.FileExists(d.composeFilePath(name)) {
		runDocker("compose", "-p", name, "-f", d.composeFilePath(name), "down")
	}
	return os.RemoveAll(d.stackDir(name))
}

// SetStackDisabled writes or removes the .disabled auto-start marker. Disabling
// only affects boot-time auto-start; it does not stop a running stack.
func (d *DockerManager) SetStackDisabled(name string, disabled bool) error {
	if err := validateStackName(name); err != nil {
		return err
	}
	if !utils.IsDir(d.stackDir(name)) {
		return errors.New("stack not found")
	}
	markerPath := filepath.Join(d.stackDir(name), disabledMarker)
	if disabled {
		return os.WriteFile(markerPath, []byte(""), 0644)
	}
	if utils.FileExists(markerPath) {
		return os.Remove(markerPath)
	}
	return nil
}

// StackStatus returns the raw `docker compose ps` JSON for a stack.
func (d *DockerManager) StackStatus(name string) ([]byte, error) {
	if err := d.requireCompose(); err != nil {
		return nil, err
	}
	if err := validateStackName(name); err != nil {
		return nil, err
	}
	return runDocker("compose", "-p", name, "-f", d.composeFilePath(name), "ps", "--format", "json")
}

// AutoStartStacks brings up every non-disabled stack at boot, mirroring
// SubserviceInit's scan-and-launch loop.
func (d *DockerManager) AutoStartStacks() {
	if d.requireCompose() != nil {
		return
	}
	entries, _ := filepath.Glob(filepath.Join(d.Options.StackBaseDir, "*"))
	for _, dir := range entries {
		if !utils.IsDir(dir) {
			continue
		}
		if utils.FileExists(filepath.Join(dir, disabledMarker)) {
			continue
		}
		if !utils.FileExists(filepath.Join(dir, composeFileName)) {
			continue
		}
		name := filepath.Base(dir)
		if err := d.DeployStack(name); err != nil {
			logger.PrintAndLog("Docker", "Failed to auto-start compose stack "+name, err)
		}
	}
}

/* ---------- HTTP handlers ---------- */

// HandleComposeList serves the stack list as JSON.
func (d *DockerManager) HandleComposeList(w http.ResponseWriter, r *http.Request) {
	stacks, err := d.ListStacks()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(stacks)
	utils.SendJSONResponse(w, string(js))
}

// HandleComposeGet returns one stack's YAML (GET: name).
func (d *DockerManager) HandleComposeGet(w http.ResponseWriter, r *http.Request) {
	name, err := utils.GetPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "missing stack name")
		return
	}
	content, err := d.GetStackYAML(name)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(map[string]string{"name": name, "content": content})
	utils.SendJSONResponse(w, string(js))
}

// HandleComposeSave validates and persists a stack (POST JSON: name, content).
func (d *DockerManager) HandleComposeSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	var req composeSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.SendErrorResponse(w, "invalid request body")
		return
	}
	if err := d.SaveStack(req.Name, req.Content); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// handleComposeStackAction is the shared POST handler body for deploy/down/delete.
func (d *DockerManager) handleComposeStackAction(w http.ResponseWriter, r *http.Request, action func(name string) error) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	name, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "missing stack name")
		return
	}
	if err := action(name); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func (d *DockerManager) HandleComposeDeploy(w http.ResponseWriter, r *http.Request) {
	d.handleComposeStackAction(w, r, d.DeployStack)
}

func (d *DockerManager) HandleComposeDown(w http.ResponseWriter, r *http.Request) {
	d.handleComposeStackAction(w, r, d.DownStack)
}

func (d *DockerManager) HandleComposeDelete(w http.ResponseWriter, r *http.Request) {
	d.handleComposeStackAction(w, r, d.DeleteStack)
}

// HandleComposeDisable toggles the .disabled marker (POST: name, disabled).
func (d *DockerManager) HandleComposeDisable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	name, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "missing stack name")
		return
	}
	disabled, _ := utils.PostBool(r, "disabled")
	if err := d.SetStackDisabled(name, disabled); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleComposeStatus serves `docker compose ps` JSON for a stack (GET: name).
func (d *DockerManager) HandleComposeStatus(w http.ResponseWriter, r *http.Request) {
	name, err := utils.GetPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "missing stack name")
		return
	}
	out, err := d.StackStatus(name)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendJSONResponse(w, string(out))
}

// HandleComposeLogs streams `docker compose logs -f` over a websocket (GET: name).
func (d *DockerManager) HandleComposeLogs(w http.ResponseWriter, r *http.Request) {
	name, err := utils.GetPara(r, "name")
	if err != nil {
		http.Error(w, "missing stack name", http.StatusBadRequest)
		return
	}
	if err := validateStackName(name); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := d.requireCompose(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	conn, err := dockerWsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	cmd := exec.Command("docker", "compose", "-p", name, "-f", d.composeFilePath(name), "logs", "-f", "--tail", "200")
	streamCommandToWS(conn, cmd)
}
