package docker

/*
	logs.go

	WebSocket streaming of long-running docker output (container logs now;
	compose logs reuse streamCommandToWS in the compose phase). The upgrade
	happens inside the already-auth-checked handler body, exactly like
	src/cast.go's arozcast websocket. When the client disconnects, the spawned
	docker process is killed so no orphaned `docker logs -f` lingers.
*/

import (
	"io"
	"net/http"
	"os/exec"

	"github.com/gorilla/websocket"
	"imuslab.com/arozos/mod/utils"
)

// dockerWsUpgrader upgrades HTTP requests to websockets for streaming endpoints.
var dockerWsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// streamCommandToWS runs cmd, streams its merged stdout+stderr to the websocket
// as text frames, and kills the process when the client disconnects. It blocks
// until the command exits or the client goes away.
func streamCommandToWS(conn *websocket.Conn, cmd *exec.Cmd) {
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to start: "+err.Error()))
		pw.Close()
		return
	}

	//Close the pipe writer once the process exits so the read loop below ends.
	go func() {
		cmd.Wait()
		pw.Close()
	}()

	//Reader goroutine: any read error (or client close) means the client is
	//gone — kill the docker process to stop the stream.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				if cmd.Process != nil {
					cmd.Process.Kill()
				}
				return
			}
		}
	}()

	buf := make([]byte, 4096)
	for {
		n, err := pr.Read(buf)
		if n > 0 {
			if werr := conn.WriteMessage(websocket.TextMessage, buf[:n]); werr != nil {
				//Client write failed — stop the process and bail.
				if cmd.Process != nil {
					cmd.Process.Kill()
				}
				return
			}
		}
		if err != nil {
			return
		}
	}
}

// HandleContainerLogs streams the tail of a container's logs over a websocket.
func (d *DockerManager) HandleContainerLogs(w http.ResponseWriter, r *http.Request) {
	ref, err := utils.GetPara(r, "id")
	if err != nil {
		http.Error(w, "missing container id", http.StatusBadRequest)
		return
	}
	if err := validateContainerRef(ref); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	conn, err := dockerWsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	cmd := exec.Command("docker", "logs", "-f", "--tail", "200", ref)
	streamCommandToWS(conn, cmd)
}
