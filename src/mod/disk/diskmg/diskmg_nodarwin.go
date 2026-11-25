//go:build !darwin

package diskmg

import (
	"net/http"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

func handleViewDarwin(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("disk/diskmg", "handleViewDarwin", "r", r))
	utils.SendErrorResponse(w, "darwin only")
}

func handleMountDarwin(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In1("disk/diskmg", "handleMountDarwin", "r", r))
	utils.SendErrorResponse(w, "darwin only")
}
