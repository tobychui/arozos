package docker

/*
	registry.go

	Registry credential management and image discovery. Credentials are never
	stored by ArozOS: `docker login` writes them to the docker CLI's own
	credential store, and we only ever read back the registry *endpoint* names
	from ~/.docker/config.json (the "auths" keys) — never the secrets.

	The login password is fed to `docker login --password-stdin` over stdin so
	it never appears in argv (process table) or any log line.
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

var (
	registryHostRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$`)
	registryUserRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._@+-]*$`)
	searchTermRegex   = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/-]*$`)
)

// dockerConfig is the subset of ~/.docker/config.json we read. Only the keys of
// "auths" (the configured registry endpoints) are ever exposed; the values
// (which hold credentials) are intentionally ignored.
type dockerConfig struct {
	Auths map[string]json.RawMessage `json:"auths"`
}

// dockerConfigPath returns the path to the docker CLI config for the user the
// arozos process runs as. Honors DOCKER_CONFIG when set (docker's own override).
func dockerConfigPath() (string, error) {
	if dc := os.Getenv("DOCKER_CONFIG"); dc != "" {
		return filepath.Join(dc, "config.json"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".docker", "config.json"), nil
}

// parseRegistryConfig extracts the configured registry endpoint names from a
// docker config.json byte blob. Returns an empty slice (not an error) when no
// auths are present. Pure function, unit-testable without a real config file.
func parseRegistryConfig(configBytes []byte) ([]string, error) {
	var cfg dockerConfig
	if err := json.Unmarshal(configBytes, &cfg); err != nil {
		return nil, err
	}
	registries := []string{}
	for endpoint := range cfg.Auths {
		registries = append(registries, endpoint)
	}
	return registries, nil
}

// ListRegistries returns the configured registry endpoints. A missing config
// file is not an error — it just means no registries are logged in.
func (d *DockerManager) ListRegistries() ([]string, error) {
	path, err := dockerConfigPath()
	if err != nil {
		return []string{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return []string{}, nil
	}
	return parseRegistryConfig(data)
}

// Login authenticates against a registry. registry may be empty for Docker Hub.
// The password is supplied via stdin and never placed in argv.
func (d *DockerManager) Login(registry, username, password string) error {
	if username == "" || password == "" {
		return errors.New("username and password are required")
	}
	if !registryUserRegex.MatchString(username) {
		return errors.New("invalid username")
	}
	args := []string{"login", "--username", username, "--password-stdin"}
	if registry != "" {
		if !registryHostRegex.MatchString(registry) {
			return errors.New("invalid registry host")
		}
		args = append(args, registry)
	}

	cmd := exec.Command("docker", args...)
	cmd.Stdin = strings.NewReader(password)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return errors.New(msg)
	}
	return nil
}

// Logout drops stored credentials for a registry (empty = Docker Hub).
func (d *DockerManager) Logout(registry string) error {
	args := []string{"logout"}
	if registry != "" {
		if !registryHostRegex.MatchString(registry) {
			return errors.New("invalid registry host")
		}
		args = append(args, registry)
	}
	_, err := runDocker(args...)
	return err
}

// SearchResult mirrors `docker search --format "{{json .}}"` per-line output.
type SearchResult struct {
	Name        string `json:"Name"`
	Description string `json:"Description"`
	StarCount   string `json:"StarCount"`
	IsOfficial  string `json:"IsOfficial"`
}

// Search queries Docker Hub for images matching term.
func (d *DockerManager) Search(term string) ([]SearchResult, error) {
	if !searchTermRegex.MatchString(term) {
		return nil, errors.New("invalid search term")
	}
	out, err := runDocker("search", "--limit", "25", "--format", "{{json .}}", term)
	if err != nil {
		return nil, err
	}
	return parseSearchResults(out)
}

// parseSearchResults parses the line-delimited JSON of `docker search`.
func parseSearchResults(out []byte) ([]SearchResult, error) {
	results := []SearchResult{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var sr SearchResult
		if err := json.Unmarshal([]byte(line), &sr); err != nil {
			continue
		}
		results = append(results, sr)
	}
	return results, nil
}

/* ---------- HTTP handlers ---------- */

// HandleRegistryList serves the configured registry endpoints as JSON.
func (d *DockerManager) HandleRegistryList(w http.ResponseWriter, r *http.Request) {
	registries, err := d.ListRegistries()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(registries)
	utils.SendJSONResponse(w, string(js))
}

// HandleRegistryLogin authenticates against a registry (POST: registry,
// username, password). The password is read from the body and never logged.
func (d *DockerManager) HandleRegistryLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	registry, _ := utils.PostPara(r, "registry")
	username, _ := utils.PostPara(r, "username")
	password, _ := utils.PostPara(r, "password")
	if err := d.Login(registry, username, password); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleRegistryLogout drops stored credentials for a registry (POST: registry).
func (d *DockerManager) HandleRegistryLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	registry, _ := utils.PostPara(r, "registry")
	if err := d.Logout(registry); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleRegistrySearch searches Docker Hub (GET: term).
func (d *DockerManager) HandleRegistrySearch(w http.ResponseWriter, r *http.Request) {
	term, err := utils.GetPara(r, "term")
	if err != nil {
		utils.SendErrorResponse(w, "missing search term")
		return
	}
	results, err := d.Search(term)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}
