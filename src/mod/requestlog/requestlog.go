package requestlog

/*
	ArozOS Extended Request Logger

	When enabled via the --extended_log flag, every HTTP request is assigned a
	UUID that is:
	  - injected into the request context (for downstream components to read)
	  - returned to the client as the X-Arozos-RequestId response header

	The middleware logs two lines per request:
	  RECV  – method, path, remote address, and all request headers (sensitive
	          headers such as Cookie and Authorization are redacted)
	  DONE  – method, path, status code, and elapsed time

	Downstream components (e.g. prouter) call LogComponent to append a
	third line that records which module handled the request.
*/

import (
	"bufio"
	"context"
	"fmt"
	"net"
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

// sensitiveHeaders lists canonical header names whose full values are redacted.
var sensitiveHeaders = map[string]bool{
	"Authorization": true,
	"Set-Cookie":    true,
	"X-Auth-Token":  true,
	"X-Api-Key":     true,
}

// sanitizeHeader returns the header value safe for logging. Cookie headers show
// cookie names with redacted values; other sensitive headers are fully redacted.
func sanitizeHeader(name, value string) string {
	canonical := http.CanonicalHeaderKey(name)
	if canonical == "Cookie" {
		var parts []string
		for _, pair := range strings.Split(value, ";") {
			pair = strings.TrimSpace(pair)
			if idx := strings.IndexByte(pair, '='); idx >= 0 {
				parts = append(parts, pair[:idx+1]+"[REDACTED]")
			} else {
				parts = append(parts, pair)
			}
		}
		return strings.Join(parts, "; ")
	}
	if sensitiveHeaders[canonical] {
		return "[REDACTED]"
	}
	return value
}

// responseRecorder wraps http.ResponseWriter to capture the written status code.
// It also tracks whether the connection was hijacked (e.g. for WebSocket
// upgrades) so that post-hijack calls to WriteHeader/Write are silently
// dropped rather than producing "WriteHeader on hijacked connection" warnings.
type responseRecorder struct {
	http.ResponseWriter
	statusCode  int
	wroteHeader bool
	hijacked    bool
}

func (rr *responseRecorder) WriteHeader(code int) {
	if rr.hijacked || rr.wroteHeader {
		return
	}
	rr.statusCode = code
	rr.wroteHeader = true
	rr.ResponseWriter.WriteHeader(code)
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
	if rr.hijacked {
		// The raw connection is owned by the WebSocket handler; writes must go
		// there directly, not through the http.ResponseWriter.
		return len(b), nil
	}
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

// Hijack implements http.Hijacker so that WebSocket upgrades work through the
// middleware. Sets hijacked=true so subsequent WriteHeader/Write calls are
// suppressed to avoid "WriteHeader on hijacked connection" log noise.
func (rr *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := rr.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("requestlog: underlying ResponseWriter does not implement http.Hijacker")
	}
	conn, brw, err := hijacker.Hijack()
	if err == nil {
		rr.hijacked = true
		rr.wroteHeader = true
		rr.statusCode = http.StatusSwitchingProtocols
	}
	return conn, brw, err
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

		// Collect, sanitize, and sort headers for a deterministic log line
		var headerParts []string
		for name, values := range r.Header {
			sanitized := sanitizeHeader(name, strings.Join(values, ", "))
			headerParts = append(headerParts, fmt.Sprintf("%s: %s", name, sanitized))
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
