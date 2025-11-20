package iot

import (
	"testing"
)

func TestEndpointStruct(t *testing.T) {
	// Test creating an Endpoint structure
	endpoint := Endpoint{
		RelPath: "/api/toggle",
		Name:    "Toggle Light",
		Desc:    "Toggle the light on and off",
		Type:    "bool",
	}
	if endpoint.Name != "Toggle Light" {
		t.Error("Name mismatch")
	}
}
