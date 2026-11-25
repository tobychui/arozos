//go:build !darwin

package diskmg

import (
	"net/http"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

func handleViewDarwin(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("disk/diskmg", "handleViewDarwin: r=%s", logger.RequestSummary(r))
	}
	utils.SendErrorResponse(w, "darwin only")
}

func handleMountDarwin(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("disk/diskmg", "handleMountDarwin: r=%s", logger.RequestSummary(r))
	}
	utils.SendErrorResponse(w, "darwin only")
}
