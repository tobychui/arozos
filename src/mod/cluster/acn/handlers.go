package acn

/*
	ArozOS Cluster Node protocol (ACN) - server side plumbing

	Server owns the HTTP mux mounted at BasePath on every node. Higher layers
	(membership, metadata, storage, jobs) register their endpoints on it with
	Handle / HandleFunc, which wrap the handler with signature verification.

	Built-in endpoints:
		GET  /cluster/acn/hello              anonymous reachability probe
		POST /cluster/acn/ping               signed round trip check
		GET  /cluster/acn/tunnel             tunnel upgrade for NAT-only nodes
		*    /cluster/acn/relay/{node}/...   forward to a node tunnelled here
*/

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// AuthenticatedHandler is a handler that only runs for verified members.
type AuthenticatedHandler func(w http.ResponseWriter, r *http.Request, sender *SignedIdentity, body []byte)

// HelloResponse is the anonymous reachability reply.
type HelloResponse struct {
	ACN       bool   `json:"acn"`
	Version   string `json:"version"`
	InCluster bool   `json:"inCluster"`
	Time      int64  `json:"time"`
}

// Server mounts the ACN endpoints of this node.
type Server struct {
	Verifier *Verifier
	Hub      *TunnelHub
	Version  string
	mux      *http.ServeMux
}

// NewServer builds the ACN mux with the built-in endpoints registered.
func NewServer(verifier *Verifier, hub *TunnelHub, version string) *Server {
	s := &Server{
		Verifier: verifier,
		Hub:      hub,
		Version:  version,
		mux:      http.NewServeMux(),
	}
	s.mux.HandleFunc(BasePath+"/hello", s.handleHello)
	s.mux.HandleFunc(RelayPrefix+"/", s.handleRelay)
	if hub != nil {
		s.mux.HandleFunc(TunnelPath, hub.HandleTunnel)
	}
	s.HandleFunc(BasePath+"/ping", func(w http.ResponseWriter, r *http.Request, sender *SignedIdentity, body []byte) {
		WriteJSON(w, map[string]interface{}{"pong": true, "node": sender.NodeID, "time": time.Now().Unix()})
	})
	return s
}

// ServeHTTP lets the server be mounted in the main router.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// HandleFunc registers a signed endpoint. Requests failing verification get 401.
func (s *Server) HandleFunc(path string, handler AuthenticatedHandler) {
	s.mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		sender, body, err := s.Verifier.VerifyRequest(r)
		if err != nil {
			status := http.StatusUnauthorized
			if errors.Is(err, ErrBodyTooLarge) {
				status = http.StatusRequestEntityTooLarge
			}
			http.Error(w, err.Error(), status)
			return
		}
		handler(w, r, sender, body)
	})
}

// HandleRaw registers an endpoint without verification. Only for endpoints
// that carry their own credentials (join tokens) or are intentionally public.
func (s *Server) HandleRaw(path string, handler http.HandlerFunc) {
	s.mux.HandleFunc(path, handler)
}

func (s *Server) handleHello(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, HelloResponse{
		ACN:       true,
		Version:   s.Version,
		InCluster: s.Verifier.ClusterID() != "",
		Time:      time.Now().Unix(),
	})
}

// handleRelay verifies the sender and forwards the request over the tunnel of
// the target node. The signature (made over the original path) is preserved.
func (s *Server) handleRelay(w http.ResponseWriter, r *http.Request) {
	target, original, ok := StripRelayPrefix(r.URL.Path)
	if !ok {
		http.Error(w, "invalid relay path", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(original, BasePath+"/") {
		http.Error(w, "relay only forwards ACN paths", http.StatusBadRequest)
		return
	}
	_, body, err := s.Verifier.VerifyRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	if s.Hub == nil || !s.Hub.Connected(target) {
		http.Error(w, ErrTunnelNotConnected.Error(), http.StatusBadGateway)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), DefaultRequestTimeout)
	defer cancel()
	resp, err := s.Hub.Do(ctx, target, r.Method, SignedTarget(original, r.URL.RawQuery), signedHeaders(r), body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.Status)
	w.Write(resp.Body)
}

// WriteJSON encodes v as the JSON response body.
func WriteJSON(w http.ResponseWriter, v interface{}) {
	js, err := json.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(js)
}

// WriteError sends a plain text error with the given status.
func WriteError(w http.ResponseWriter, status int, msg string) {
	http.Error(w, msg, status)
}
