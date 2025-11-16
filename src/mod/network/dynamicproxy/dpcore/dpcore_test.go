package dpcore

import (
	"net/url"
	"testing"
)

func TestNewDynamicProxyCore(t *testing.T) {
	target, err := url.Parse("http://localhost:8080")
	if err != nil {
		t.Fatal(err)
	}
	core := NewDynamicProxyCore(target, "/proxy")
	if core == nil {
		t.Error("Core should not be nil")
	}
}
