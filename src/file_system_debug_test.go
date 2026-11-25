package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/info/logger"
)

// TestFsDebugRequestParams checks which request values the trace names, and
// that a multipart upload body is left unread
func TestFsDebugRequestParams(t *testing.T) {
	long := strings.Repeat("x", fsDebugMaxValue+50)
	tests := []struct {
		name        string
		method      string
		url         string
		contentType string
		body        string
		want        string
	}{
		{"query only", "GET", "/system/file_system/listDir?dir=user:/Music&sort=name", "", "", " dir=user:/Music"},
		{"urlencoded post", "POST", "/system/file_system/fileOpr", "application/x-www-form-urlencoded", "opr=copy&src=user:/a&dest=S1:/", " opr=copy src=user:/a dest=S1:/"},
		{"long value cut", "GET", "/x?path=" + long, "", "", " path=" + long[:fsDebugMaxValue] + "...(350 bytes)"},
		{"multipart left alone", "POST", "/system/file_system/upload?path=user:/Desktop", "multipart/form-data; boundary=zz", "--zz\r\nContent-Disposition: form-data; name=\"opr\"\r\n\r\nsecret\r\n--zz--\r\n", " path=user:/Desktop"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(tt.method, tt.url, strings.NewReader(tt.body))
			if tt.contentType != "" {
				r.Header.Set("Content-Type", tt.contentType)
			}
			if got := fsDebugRequestParams(r); got != tt.want {
				t.Errorf("params = %q, want %q", got, tt.want)
			}
			if tt.contentType == "application/x-www-form-urlencoded" && r.FormValue("opr") != "copy" {
				t.Error("the handler no longer sees the posted values")
			}
			if strings.HasPrefix(tt.contentType, "multipart/") && r.MultipartForm != nil {
				t.Error("the multipart body was parsed by the trace")
			}
		})
	}
}

// TestFsDebugHandlerOff checks that handlers are registered unchanged while
// debug logging is off
func TestFsDebugHandlerOff(t *testing.T) {
	was := logger.IsDebug()
	logger.SetDebug(false)
	t.Cleanup(func() { logger.SetDebug(was) })

	called := false
	handler := func(w http.ResponseWriter, r *http.Request) { called = true }
	wrapped := fsDebugHandler("/system/file_system/listDir", handler)
	wrapped(httptest.NewRecorder(), httptest.NewRequest("GET", "/system/file_system/listDir", nil))
	if !called {
		t.Error("the handler was not called")
	}
}
