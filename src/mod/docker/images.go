package docker

/*
	images.go

	Image listing, removal and (streamed) pulling. Pulling reuses the websocket
	command-streaming helper from logs.go so the layered download progress shows
	live in the UI. Image references are validated to block flag injection and
	obvious shell metacharacters before being passed to the docker CLI.
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"regexp"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// imageRefRegex permits registry/repo:tag@digest forms and image IDs while
// rejecting a leading dash (flag injection) and shell metacharacters.
var imageRefRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$`)

// ImageInfo mirrors the subset of `docker images --format "{{json .}}"` output
// consumed by the UI.
type ImageInfo struct {
	ID           string `json:"ID"`
	Repository   string `json:"Repository"`
	Tag          string `json:"Tag"`
	Size         string `json:"Size"`
	CreatedSince string `json:"CreatedSince"`
	CreatedAt    string `json:"CreatedAt"`
	Digest       string `json:"Digest"`
}

// validateImageRef rejects empty or malformed image references.
func validateImageRef(ref string) (out0 error) {
	defer logger.Out1(logger.In1("docker", "validateImageRef", "ref", ref), &out0)
	if ref == "" {
		return errors.New("empty image reference")
	}
	if !imageRefRegex.MatchString(ref) {
		return errors.New("invalid image reference")
	}
	return nil
}

// ListImages returns all locally stored images.
func (d *DockerManager) ListImages() (out0 []ImageInfo, out1 error) {
	defer logger.Out2(logger.In1("docker", "DockerManager.ListImages", "d", d), &out0, &out1)
	out, err := runDocker("images", "--format", "{{json .}}")
	if err != nil {
		logger.DebugErr("docker", err)
		return nil, err
	}
	return parseImageList(out)
}

// parseImageList parses the line-delimited JSON of `docker images`. Malformed
// lines are skipped defensively.
func parseImageList(out []byte) (out0 []ImageInfo, out1 error) {
	defer logger.Out2(logger.In1("docker", "parseImageList", "out", out), &out0, &out1)
	results := []ImageInfo{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var img ImageInfo
		if err := json.Unmarshal([]byte(line), &img); err != nil {
			logger.DebugErr("docker", err)
			continue
		}
		results = append(results, img)
	}
	return results, nil
}

// RemoveImage removes a local image by reference or ID.
func (d *DockerManager) RemoveImage(ref string) (out0 error) {
	defer logger.Out1(logger.In2("docker", "DockerManager.RemoveImage", "d", d, "ref", ref), &out0)
	if err := validateImageRef(ref); err != nil {
		logger.DebugErr("docker", err)
		return err
	}
	_, err := runDocker("rmi", ref)
	return err
}

/* ---------- HTTP handlers ---------- */

// HandleImageList serves the local image list as JSON.
func (d *DockerManager) HandleImageList(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("docker", "DockerManager.HandleImageList", "d", d, "r", r))
	images, err := d.ListImages()
	if err != nil {
		logger.DebugErr("docker", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(images)
	utils.SendJSONResponse(w, string(js))
}

// HandleImageRemove removes a local image (POST, field "id").
func (d *DockerManager) HandleImageRemove(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("docker", "DockerManager.HandleImageRemove", "d", d, "r", r))
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	ref, err := utils.PostPara(r, "id")
	if err != nil {
		logger.DebugErr("docker", err)
		utils.SendErrorResponse(w, "missing image id")
		return
	}
	if err := d.RemoveImage(ref); err != nil {
		logger.DebugErr("docker", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleImagePull streams `docker pull <image>` progress over a websocket. The
// browser opens this with a GET websocket carrying ?image=<ref>.
func (d *DockerManager) HandleImagePull(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("docker", "DockerManager.HandleImagePull", "d", d, "r", r))
	ref, err := utils.GetPara(r, "image")
	if err != nil {
		logger.DebugErr("docker", err)
		http.Error(w, "missing image reference", http.StatusBadRequest)
		return
	}
	if err := validateImageRef(ref); err != nil {
		logger.DebugErr("docker", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	conn, err := dockerWsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.DebugErr("docker", err)
		return
	}
	defer conn.Close()

	cmd := exec.Command("docker", "pull", ref)
	streamCommandToWS(conn, cmd)
}
