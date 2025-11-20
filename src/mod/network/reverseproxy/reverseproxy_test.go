package reverseproxy

import (
	"net/url"
	"testing"
)

func TestNewReverseProxy(t *testing.T) {
	target, err := url.Parse("http://localhost:8080")
	if err != nil {
		t.Fatal(err)
	}
	proxy := NewReverseProxy(target)
	if proxy == nil {
		t.Error("Proxy should not be nil")
	}
}
