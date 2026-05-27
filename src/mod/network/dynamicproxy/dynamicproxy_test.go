package dynamicproxy

import (
	"testing"
)

func TestNewDynamicProxy(t *testing.T) {
	router, err := NewDynamicProxy(0) // port 0 to let OS assign
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}
	if router == nil {
		t.Fatal("Expected non-nil Router")
	}
	if router.ProxyEndpoints == nil {
		t.Error("Expected non-nil ProxyEndpoints")
	}
	if router.SubdomainEndpoint == nil {
		t.Error("Expected non-nil SubdomainEndpoint")
	}
}

func TestAddProxyService(t *testing.T) {
	router, err := NewDynamicProxy(0)
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}

	// Add a proxy endpoint
	err = router.AddProxyService("/api", "http://localhost:8080", false)
	if err != nil {
		t.Fatalf("AddProxyService() unexpected error: %v", err)
	}

	// Add with TLS enabled
	err = router.AddProxyService("/secure", "localhost:9090", true)
	if err != nil {
		t.Fatalf("AddProxyService() with TLS unexpected error: %v", err)
	}
}

func TestSetRootProxy(t *testing.T) {
	router, err := NewDynamicProxy(0)
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}

	err = router.SetRootProxy("http://localhost:8080", false)
	if err != nil {
		t.Fatalf("SetRootProxy() unexpected error: %v", err)
	}

	// Verify root was set
	if router.Root == nil {
		t.Error("Expected Root to be set")
	}
}

func TestStartStopProxy(t *testing.T) {
	router, err := NewDynamicProxy(0)
	if err != nil {
		t.Fatalf("NewDynamicProxy() unexpected error: %v", err)
	}
	router.SetRootProxy("http://localhost:8080", false)

	// Test that stopping before starting returns an error or is a no-op
	err = router.StopProxyService()
	if err != nil {
		// Acceptable to get an error when not running
		t.Logf("StopProxyService() returned error when not running (expected): %v", err)
	}
}
