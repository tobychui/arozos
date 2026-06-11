//go:build !darwin

package diskmg

import (
	"net/http"

	"imuslab.com/arozos/mod/utils"
)

func handleViewDarwin(w http.ResponseWriter, r *http.Request) {
	utils.SendErrorResponse(w, "darwin only")
}

func handleMountDarwin(w http.ResponseWriter, r *http.Request) {
	utils.SendErrorResponse(w, "darwin only")
}
