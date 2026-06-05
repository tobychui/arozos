package requestlog

/*
	ArozOS Extended Request Logger

	When enabled via the --extended_log flag, every HTTP request is assigned a
	UUID that is:
	  - injected into the request context (for downstream components to read)
	  - returned to the client as the X-Arozos-RequestId response header

	The middleware logs two lines per request:
	  RECV  – method, path, remote address, and all request headers
	  DONE  – method, path, status code, and elapsed time

	Downstream components (e.g. prouter) call LogComponent to append a
	third line that records which module handled the request.
*/

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/info/logger"
)

type contextKey string

const requestIDKey contextKey = "x-arozos-requestId"

// Enabled is set once at startup by main() when --extended_log is passed.
var Enabled bool

// responseRecorder wraps http.ResponseWriter to capture the written status code.
type responseRecorder struct {
	http.ResponseWriter
	statusCode  int
	wroteHeader bool
}

func (rr *responseRecorder) WriteHeader(code int) {
	if !rr.wroteHeader {
		rr.statusCode = code
		rr.wroteHeader = true
		rr.ResponseWriter.WriteHeader(code)
	}
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
	if !rr.wroteHeader {
		rr.WriteHeader(http.StatusOK)
	}
	return rr.ResponseWriter.Write(b)
}

func (rr *responseRecorder) status() int {
	if !rr.wroteHeader {
		return http.StatusOK
	}
	return rr.statusCode
}

// GetRequestID retrieves the request ID injected by Middleware from the
// request context. Returns an empty string if extended logging is disabled.
func GetRequestID(r *http.Request) string {
	if id, ok := r.Context().Value(requestIDKey).(string); ok {
		return id
	}
	return ""
}

// LogComponent records which module/component accepted a request. Call this
// from prouter or any other handler that knows its own module name.
func LogComponent(r *http.Request, component, endpoint string) {
	if !Enabled {
		return
	}
	requestID := GetRequestID(r)
	logger.PrintAndLog("RequestLog", fmt.Sprintf(
		"HDLR requestId=%s component=%s endpoint=%s",
		requestID, component, endpoint,
	), nil)
}

// Middleware wraps next and performs extended request logging when Enabled.
// When disabled it is a transparent pass-through with zero overhead.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !Enabled {
			next.ServeHTTP(w, r)
			return
		}

		requestID := uuid.NewV4().String()

		// Propagate the request ID through context
		ctx := context.WithValue(r.Context(), requestIDKey, requestID)
		r = r.WithContext(ctx)

		// Expose request ID to the client
		w.Header().Set("X-Arozos-RequestId", requestID)

		// Collect and sort headers for a deterministic log line
		var headerParts []string
		for name, values := range r.Header {
			headerParts = append(headerParts, fmt.Sprintf("%s: %s", name, strings.Join(values, ", ")))
		}
		sort.Strings(headerParts)

		logger.PrintAndLog("RequestLog", fmt.Sprintf(
			"RECV requestId=%s method=%s path=%s remoteAddr=%s headers=[%s]",
			requestID,
			r.Method,
			r.URL.RequestURI(),
			r.RemoteAddr,
			strings.Join(headerParts, " | "),
		), nil)

		rec := &responseRecorder{ResponseWriter: w}
		start := time.Now()

		next.ServeHTTP(rec, r)

		logger.PrintAndLog("RequestLog", fmt.Sprintf(
			"DONE requestId=%s method=%s path=%s status=%d duration=%s",
			requestID,
			r.Method,
			r.URL.RequestURI(),
			rec.status(),
			time.Since(start).Round(time.Millisecond),
		), nil)
	})
}
