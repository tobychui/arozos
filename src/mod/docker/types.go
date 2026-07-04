package docker

/*
	types.go

	Shared JSON-shape structs for the Docker management module. The structs that
	mirror `docker ... --format json` output are intentionally permissive (most
	fields are strings) because the docker CLI emits every value as a string in
	its line-delimited JSON, and the exact field set varies between docker
	versions — same defensive approach used by mod/disk/diskmg for lsblk output.
*/

// EngineStatus is the high-level health/capability summary surfaced to the
// settings page and the desktop app. It is what /system/docker/engine/status
// returns.
type EngineStatus struct {
	Available        bool   `json:"available"`        //Docker daemon reachable
	ServerVersion    string `json:"serverVersion"`    //Docker engine (server) version
	APIVersion       string `json:"apiVersion"`       //Engine API version
	OS               string `json:"os"`               //Engine host OS, e.g. "linux"
	Arch             string `json:"arch"`             //Engine host arch, e.g. "amd64"
	ComposeAvailable bool   `json:"composeAvailable"` //docker compose v2 plugin present
	ComposeVersion   string `json:"composeVersion"`   //Compose plugin version, empty if absent
}

// dockerVersionOutput maps the subset of `docker version --format "{{json .}}"`
// that the settings page needs. Only the Server block is consumed.
type dockerVersionOutput struct {
	Server struct {
		Version    string `json:"Version"`
		APIVersion string `json:"ApiVersion"`
		Os         string `json:"Os"`
		Arch       string `json:"Arch"`
	} `json:"Server"`
}
