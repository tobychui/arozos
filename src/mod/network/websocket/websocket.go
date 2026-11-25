package websocket

import "imuslab.com/arozos/mod/info/logger"
import "net/http"

type Router struct {
}

func NewRouter() *Router {
	logger.DebugTrace("network/websocket", "NewRouter")
	return &Router{}

}

func (s *Router) HandleWebSocketRouting(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/websocket", "Router.HandleWebSocketRouting: r=%s", logger.RequestSummary(r))
	}
	//WIP
	http.NotFound(w, r)
}
