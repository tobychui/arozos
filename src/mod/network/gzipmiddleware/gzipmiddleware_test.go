package gzipmiddleware

import (
	"net/http"
	"testing"
)

func TestCompress(t *testing.T) {
	// Test that Compress function creates a handler
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("test"))
	})
	handler := Compress(testHandler)
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
