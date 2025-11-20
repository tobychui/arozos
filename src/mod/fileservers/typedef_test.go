package fileservers

import (
	"testing"

	user "imuslab.com/arozos/mod/user"
)

func TestEndpoint_Creation(t *testing.T) {
	// Test case 1: Create basic endpoint
	endpoint := Endpoint{
		ProtocolName: "ftp",
		Port:         21,
		Subpath:      "/files",
	}

	if endpoint.ProtocolName != "ftp" {
		t.Errorf("Test case 1 failed. Expected protocol 'ftp', got '%s'", endpoint.ProtocolName)
	}

	if endpoint.Port != 21 {
		t.Errorf("Test case 1 failed. Expected port 21, got %d", endpoint.Port)
	}

	if endpoint.Subpath != "/files" {
		t.Errorf("Test case 1 failed. Expected subpath '/files', got '%s'", endpoint.Subpath)
	}

	// Test case 2: Create endpoint with different protocol
	webdavEndpoint := Endpoint{
		ProtocolName: "webdav",
		Port:         8080,
		Subpath:      "/webdav/user",
	}

	if webdavEndpoint.ProtocolName != "webdav" {
		t.Errorf("Test case 2 failed. Expected protocol 'webdav', got '%s'", webdavEndpoint.ProtocolName)
	}

	// Test case 3: Create endpoint with empty subpath
	emptySubpathEndpoint := Endpoint{
		ProtocolName: "sftp",
		Port:         22,
		Subpath:      "",
	}

	if emptySubpathEndpoint.Subpath != "" {
		t.Errorf("Test case 3 failed. Expected empty subpath, got '%s'", emptySubpathEndpoint.Subpath)
	}

	// Test case 4: Create endpoint with custom port
	customPortEndpoint := Endpoint{
		ProtocolName: "custom",
		Port:         9999,
		Subpath:      "/custom/path",
	}

	if customPortEndpoint.Port != 9999 {
		t.Errorf("Test case 4 failed. Expected port 9999, got %d", customPortEndpoint.Port)
	}
}

func TestServer_Creation(t *testing.T) {
	// Test case 1: Create basic server
	server := Server{
		ID:           "ftp-server",
		Name:         "FTP",
		Desc:         "File Transfer Protocol",
		IconPath:     "/icons/ftp.png",
		DefaultPorts: []int{21},
		Ports:        []int{21, 20},
	}

	if server.ID != "ftp-server" {
		t.Errorf("Test case 1 failed. Expected ID 'ftp-server', got '%s'", server.ID)
	}

	if server.Name != "FTP" {
		t.Errorf("Test case 1 failed. Expected name 'FTP', got '%s'", server.Name)
	}

	if len(server.DefaultPorts) != 1 {
		t.Errorf("Test case 1 failed. Expected 1 default port, got %d", len(server.DefaultPorts))
	}

	if len(server.Ports) != 2 {
		t.Errorf("Test case 1 failed. Expected 2 ports, got %d", len(server.Ports))
	}

	// Test case 2: Create server with UPnP forwarding
	upnpServer := Server{
		ID:                "webdav-server",
		Name:              "WebDAV",
		ForwardPortIfUpnp: true,
		Ports:             []int{8080},
	}

	if !upnpServer.ForwardPortIfUpnp {
		t.Error("Test case 2 failed. ForwardPortIfUpnp should be true")
	}

	// Test case 3: Create server with pages
	configuredServer := Server{
		ID:            "configured-server",
		ConnInstrPage: "/help/connection.html",
		ConfigPage:    "/admin/config.html",
	}

	if configuredServer.ConnInstrPage != "/help/connection.html" {
		t.Errorf("Test case 3 failed. Expected ConnInstrPage '/help/connection.html', got '%s'", configuredServer.ConnInstrPage)
	}

	if configuredServer.ConfigPage != "/admin/config.html" {
		t.Errorf("Test case 3 failed. Expected ConfigPage '/admin/config.html', got '%s'", configuredServer.ConfigPage)
	}
}

func TestServer_Functions(t *testing.T) {
	// Test case 1: Create server with EnableCheck function
	enableCheckCalled := false
	server := Server{
		ID:   "test-server",
		Name: "Test Server",
		EnableCheck: func() bool {
			enableCheckCalled = true
			return true
		},
	}

	if server.EnableCheck == nil {
		t.Error("Test case 1 failed. EnableCheck should not be nil")
	}

	result := server.EnableCheck()
	if !enableCheckCalled {
		t.Error("Test case 1 failed. EnableCheck function should be called")
	}

	if !result {
		t.Error("Test case 1 failed. EnableCheck should return true")
	}

	// Test case 2: Create server with ToggleFunc
	toggleCalled := false
	var toggleState bool
	server2 := Server{
		ID: "toggle-server",
		ToggleFunc: func(state bool) error {
			toggleCalled = true
			toggleState = state
			return nil
		},
	}

	if server2.ToggleFunc == nil {
		t.Error("Test case 2 failed. ToggleFunc should not be nil")
	}

	err := server2.ToggleFunc(true)
	if err != nil {
		t.Errorf("Test case 2 failed. ToggleFunc error: %v", err)
	}

	if !toggleCalled {
		t.Error("Test case 2 failed. ToggleFunc should be called")
	}

	if !toggleState {
		t.Error("Test case 2 failed. Toggle state should be true")
	}

	// Test case 3: Create server with GetEndpoints function
	endpointsCalled := false
	server3 := Server{
		ID: "endpoints-server",
		GetEndpoints: func(u *user.User) []*Endpoint {
			endpointsCalled = true
			return []*Endpoint{
				{ProtocolName: "http", Port: 80},
				{ProtocolName: "https", Port: 443},
			}
		},
	}

	if server3.GetEndpoints == nil {
		t.Error("Test case 3 failed. GetEndpoints should not be nil")
	}

	endpoints := server3.GetEndpoints(nil)
	if !endpointsCalled {
		t.Error("Test case 3 failed. GetEndpoints should be called")
	}

	if len(endpoints) != 2 {
		t.Errorf("Test case 3 failed. Expected 2 endpoints, got %d", len(endpoints))
	}

	if endpoints[0].Port != 80 {
		t.Errorf("Test case 3 failed. Expected first endpoint port 80, got %d", endpoints[0].Port)
	}
}

func TestServer_MultipleDefaultPorts(t *testing.T) {
	// Test case 1: Server with multiple default ports
	server := Server{
		ID:           "multi-port-server",
		DefaultPorts: []int{21, 22, 23, 80, 443},
	}

	if len(server.DefaultPorts) != 5 {
		t.Errorf("Test case 1 failed. Expected 5 default ports, got %d", len(server.DefaultPorts))
	}

	// Verify all ports are present
	expectedPorts := []int{21, 22, 23, 80, 443}
	for i, port := range server.DefaultPorts {
		if port != expectedPorts[i] {
			t.Errorf("Test case 1 failed. Expected port %d at index %d, got %d", expectedPorts[i], i, port)
		}
	}

	// Test case 2: Server with no default ports
	emptyPortsServer := Server{
		ID:           "no-ports-server",
		DefaultPorts: []int{},
	}

	if len(emptyPortsServer.DefaultPorts) != 0 {
		t.Errorf("Test case 2 failed. Expected 0 default ports, got %d", len(emptyPortsServer.DefaultPorts))
	}
}

func TestEndpoint_MultipleEndpoints(t *testing.T) {
	// Test case 1: Create slice of endpoints
	endpoints := []Endpoint{
		{ProtocolName: "ftp", Port: 21, Subpath: "/ftp"},
		{ProtocolName: "sftp", Port: 22, Subpath: "/sftp"},
		{ProtocolName: "webdav", Port: 8080, Subpath: "/webdav"},
	}

	if len(endpoints) != 3 {
		t.Errorf("Test case 1 failed. Expected 3 endpoints, got %d", len(endpoints))
	}

	// Verify first endpoint
	if endpoints[0].ProtocolName != "ftp" {
		t.Errorf("Test case 1 failed. Expected first protocol 'ftp', got '%s'", endpoints[0].ProtocolName)
	}

	// Verify last endpoint
	if endpoints[2].Port != 8080 {
		t.Errorf("Test case 1 failed. Expected last endpoint port 8080, got %d", endpoints[2].Port)
	}
}

func TestServer_EmptyFields(t *testing.T) {
	// Test case 1: Server with minimal fields
	server := Server{
		ID: "minimal-server",
	}

	if server.ID != "minimal-server" {
		t.Errorf("Test case 1 failed. Expected ID 'minimal-server', got '%s'", server.ID)
	}

	if server.Name != "" {
		t.Error("Test case 1 failed. Name should be empty string")
	}

	if server.Desc != "" {
		t.Error("Test case 1 failed. Desc should be empty string")
	}

	if server.ForwardPortIfUpnp {
		t.Error("Test case 1 failed. ForwardPortIfUpnp should be false by default")
	}

	// Test case 2: Verify nil function fields
	if server.EnableCheck != nil {
		t.Error("Test case 2 failed. EnableCheck should be nil when not set")
	}

	if server.ToggleFunc != nil {
		t.Error("Test case 2 failed. ToggleFunc should be nil when not set")
	}

	if server.GetEndpoints != nil {
		t.Error("Test case 2 failed. GetEndpoints should be nil when not set")
	}
}
