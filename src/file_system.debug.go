package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Debug tracing of the File Manager endpoints

	With -debug every File Manager request is logged when it starts and ends,
	with the user, the path parameters and how long it took, and a panic in
	the handler is logged with that context and its stack before net/http
	recovers it. Without -debug the handlers are registered unchanged.
*/

// fsDebugParams are the request parameters worth naming in a trace line
var fsDebugParams = []string{"opr", "path", "src", "dest", "file", "filepath", "dir", "vpath", "target", "uuid", "existsresp", "fsh", "pool", "group"}

const fsDebugMaxValue = 300 //Longer values (a JSON list of many files) are cut

// fsDebugHandler wraps a File Manager handler with request tracing while
// debug logging is on
func fsDebugHandler(endpoint string, handler func(http.ResponseWriter, *http.Request)) func(http.ResponseWriter, *http.Request) {
	if !logger.IsDebug() {
		return handler
	}
	return func(w http.ResponseWriter, r *http.Request) {
		username := "?"
		if userinfo, err := userHandler.GetUserInfoFromRequest(w, r); err == nil {
			username = userinfo.Username
		}
		params := fsDebugRequestParams(r)
		logger.Debugf("File System", "-> %s %s user=%s%s", r.Method, endpoint, username, params)

		//Deferred first so it runs last and still sees a panic of the handler
		start := time.Now()
		defer func() {
			logger.Debugf("File System", "<- %s user=%s in %s", endpoint, username, time.Since(start).Round(time.Microsecond))
		}()
		defer logger.TracePanic("File System", endpoint+" user="+username+params)
		handler(w, r)
	}
}

// fsDebugRequestParams lists the interesting parameters of a request as
// " key=value" pairs. It reads the query and urlencoded bodies only: a
// multipart body is an upload and must be left for the handler to stream.
func fsDebugRequestParams(r *http.Request) string {
	values := r.URL.Query()
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/x-www-form-urlencoded") {
		//ParseForm keeps what it read, so the handler still sees every value
		if err := r.ParseForm(); err == nil {
			values = r.Form
		}
	}

	var b strings.Builder
	for _, key := range fsDebugParams {
		value := values.Get(key)
		if value == "" {
			continue
		}
		if len(value) > fsDebugMaxValue {
			value = value[:fsDebugMaxValue] + "...(" + strconv.Itoa(len(value)) + " bytes)"
		}
		b.WriteString(" " + key + "=" + value)
	}
	return b.String()
}
