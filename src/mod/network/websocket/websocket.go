package websocket

import "net/http"

type Router struct {
}

func NewRouter() *Router {
	return &Router{}

}

func (s *Router) HandleWebSocketRouting(w http.ResponseWriter, r *http.Request) {
	//WIP
	http.NotFound(w, r)
}
