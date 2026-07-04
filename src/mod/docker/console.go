package docker

/*
	console.go

	Interactive container shell (`docker exec -it <container> <shell>`) bridged
	to xterm.js over a websocket. The PTY allocation is platform-specific and
	lives in build-tagged files:

	    console_unix.go    (linux || darwin) — real PTY via github.com/creack/pty
	    console_windows.go (windows)         — returns "not supported"

	Wire protocol:
	    server -> client : binary frames  = raw terminal output bytes
	    client -> server : binary frames  = raw keystroke bytes
	                       text frames    = JSON control, e.g. {"type":"resize","rows":40,"cols":120}

	This is the highest-risk surface in the whole feature: a live root-equivalent
	shell into a running container. It is admin-only (enforced by the prout router
	in src/docker.go) and, when the websocket closes, the spawned `docker exec`
	process is killed so no orphaned shell session is left running.
*/

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"

	"github.com/gorilla/websocket"
	"imuslab.com/arozos/mod/utils"
)

// shellRegex restricts the shell argument to a safe path/name charset.
var shellRegex = regexp.MustCompile(`^[a-zA-Z0-9/._-]+$`)

// ptySession abstracts a PTY-attached `docker exec` process. The concrete
// implementation is provided per-platform by startDockerExecPTY.
type ptySession interface {
	io.ReadWriteCloser
	Resize(rows, cols uint16) error
	Wait() error
	Kill()
}

// consoleControlMsg is the JSON shape of a client text control frame.
type consoleControlMsg struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// HandleExecConsole upgrades to a websocket and bridges it to an interactive
// shell inside the container given by ?id=, using ?shell= (default "sh").
func (d *DockerManager) HandleExecConsole(w http.ResponseWriter, r *http.Request) {
	ref, err := utils.GetPara(r, "id")
	if err != nil {
		http.Error(w, "missing container id", http.StatusBadRequest)
		return
	}
	if err := validateContainerRef(ref); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	shell, _ := utils.GetPara(r, "shell")
	if shell == "" {
		shell = "sh"
	}
	if !shellRegex.MatchString(shell) {
		http.Error(w, "invalid shell", http.StatusBadRequest)
		return
	}

	conn, err := dockerWsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	session, err := startDockerExecPTY(ref, shell)
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to start console: "+err.Error()))
		return
	}
	//Ensure the docker exec process is always killed when this handler returns.
	defer session.Kill()

	//Output pump: PTY -> websocket (binary frames). When the shell exits the
	//read returns an error and we close the socket to signal end-of-session.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, rerr := session.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					return
				}
			}
			if rerr != nil {
				conn.Close()
				return
			}
		}
	}()

	//Input pump: websocket -> PTY. Binary frames are keystrokes; text frames are
	//JSON control messages (currently only "resize").
	for {
		mt, data, rerr := conn.ReadMessage()
		if rerr != nil {
			return
		}
		if mt == websocket.TextMessage {
			var ctrl consoleControlMsg
			if json.Unmarshal(data, &ctrl) == nil && ctrl.Type == "resize" {
				session.Resize(ctrl.Rows, ctrl.Cols)
			}
			continue
		}
		session.Write(data)
	}
}
