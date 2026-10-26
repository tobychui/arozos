package websocket

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestNewRouter verifies that NewRouter returns a non-nil Router.
func TestNewRouter(t *testing.T) {
	r := NewRouter()
	if r == nil {
		t.Fatal("expected NewRouter to return a non-nil *Router")
	}
}

// TestHandleWebSocketRouting_ReturnsNotFound verifies that an ordinary HTTP
// request (without a WebSocket upgrade) receives a 404 response, which is the
// current WIP behaviour of HandleWebSocketRouting.
func TestHandleWebSocketRouting_ReturnsNotFound(t *testing.T) {
	router := NewRouter()

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	rr := httptest.NewRecorder()

	router.HandleWebSocketRouting(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected status %d, got %d", http.StatusNotFound, rr.Code)
	}
}

// TestHandleWebSocketRouting_PostRequest verifies the handler does not panic on
// a POST request either.
func TestHandleWebSocketRouting_PostRequest(t *testing.T) {
	router := NewRouter()

	req := httptest.NewRequest(http.MethodPost, "/ws", nil)
	rr := httptest.NewRecorder()

	router.HandleWebSocketRouting(rr, req)

	// The handler currently responds with 404 regardless of method.
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected status %d, got %d", http.StatusNotFound, rr.Code)
	}
}
