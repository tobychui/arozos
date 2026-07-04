//go:build linux || darwin

package docker

/*
	console_unix.go

	Real PTY-backed `docker exec -it` for Linux/macOS hosts using
	github.com/creack/pty (MIT). Isolated behind a build tag so non-PTY
	platforms (Windows) compile against console_windows.go instead, per the
	project's cross-platform rule.
*/

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

// unixPTY is a ptySession backed by a creack/pty master file.
type unixPTY struct {
	ptmx *os.File
	cmd  *exec.Cmd
}

func (p *unixPTY) Read(b []byte) (int, error)  { return p.ptmx.Read(b) }
func (p *unixPTY) Write(b []byte) (int, error) { return p.ptmx.Write(b) }
func (p *unixPTY) Close() error                { return p.ptmx.Close() }

func (p *unixPTY) Resize(rows, cols uint16) error {
	return pty.Setsize(p.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (p *unixPTY) Wait() error { return p.cmd.Wait() }

func (p *unixPTY) Kill() {
	if p.cmd.Process != nil {
		p.cmd.Process.Kill()
	}
	p.ptmx.Close()
}

// startDockerExecPTY launches `docker exec -it <ref> <shell>` attached to a new
// pseudo-terminal and returns the session.
func startDockerExecPTY(ref, shell string) (ptySession, error) {
	cmd := exec.Command("docker", "exec", "-it", ref, shell)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &unixPTY{ptmx: ptmx, cmd: cmd}, nil
}
