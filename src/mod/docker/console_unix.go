//go:build linux || darwin || freebsd

package docker

/*
	console_unix.go

	Real PTY-backed `docker exec -it` for Linux/macOS/FreeBSD hosts using
	github.com/creack/pty (MIT). Isolated behind a build tag so non-PTY
	platforms (Windows and any other GOOS) compile against console_other.go
	instead, per the project's cross-platform rule.
*/

import (
	"os"
	"os/exec"

	"github.com/creack/pty"

	"imuslab.com/arozos/mod/info/logger"
)

// unixPTY is a ptySession backed by a creack/pty master file.
type unixPTY struct {
	ptmx *os.File
	cmd  *exec.Cmd
}

func (p *unixPTY) Read(b []byte) (int, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("docker", "unixPTY.Read: len(b)=%d", len(b))
	}
	return p.ptmx.Read(b)
}
func (p *unixPTY) Write(b []byte) (int, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("docker", "unixPTY.Write: len(b)=%d", len(b))
	}
	return p.ptmx.Write(b)
}
func (p *unixPTY) Close() error {
	logger.DebugTrace("docker", "unixPTY.Close")
	return p.ptmx.Close()
}

func (p *unixPTY) Resize(rows, cols uint16) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("docker", "unixPTY.Resize: rows=%d cols=%d", rows, cols)
	}
	return pty.Setsize(p.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (p *unixPTY) Wait() error {
	logger.DebugTrace("docker", "unixPTY.Wait")
	return p.cmd.Wait()
}

func (p *unixPTY) Kill() {
	logger.Debug("docker", "unixPTY.Kill")
	if p.cmd.Process != nil {
		p.cmd.Process.Kill()
	}
	p.ptmx.Close()
}

// startDockerExecPTY launches `docker exec -it <ref> <shell>` attached to a new
// pseudo-terminal and returns the session.
func startDockerExecPTY(ref, shell string) (ptySession, error) {
	if logger.IsDebug() {
		logger.Debugf("docker", "startDockerExecPTY: ref=%.120q shell=%.120q", ref, shell)
	}
	cmd := exec.Command("docker", "exec", "-it", ref, shell)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &unixPTY{ptmx: ptmx, cmd: cmd}, nil
}
