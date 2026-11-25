package logger

import (
	"fmt"
	"net/http"
	"sync/atomic"
)

/*
	debug.go

	The DEBUG level. Debug messages are dropped unless debug output was
	switched on, normally by the -debug flag at startup. Checking is a single
	atomic load, so a disabled Debug call costs next to nothing; code that has
	to build its message first should guard it with IsDebug:

		if logger.IsDebug() {
			logger.Debugf("Module", "loaded %d items from %q", n, path)
		}
*/

var debugEnabled atomic.Bool

// debugTraceEnabled also shows the DEBUG lines of functions that run very
// often: small helpers, io and sort methods, recursive walkers and the
// byte level parsers. Set by the -debug_trace flag, it implies debug.
var debugTraceEnabled atomic.Bool

// SetDebug turns DEBUG level output on or off for the whole system.
func SetDebug(enabled bool) {
	debugEnabled.Store(enabled)
}

// SetDebugTrace turns the DEBUG lines of frequently called functions on or
// off. Turning it on also turns DEBUG output on.
func SetDebugTrace(enabled bool) {
	debugTraceEnabled.Store(enabled)
	if enabled {
		debugEnabled.Store(true)
	}
}

// IsDebugTrace reports whether DEBUG lines of frequently called functions
// are shown.
func IsDebugTrace() bool {
	return debugTraceEnabled.Load() && debugEnabled.Load()
}

// DebugTrace logs message at DEBUG level, like Debug, but only while
// SetDebugTrace is on. Use it in functions called so often that their lines
// would drown everything else.
func DebugTrace(title string, message string) {
	if !IsDebugTrace() {
		return
	}
	defaultLogger.PrintAndLogDebug(title, message)
}

// DebugTracef is DebugTrace with a fmt.Sprintf style message.
func DebugTracef(title string, format string, args ...any) {
	if !IsDebugTrace() {
		return
	}
	defaultLogger.PrintAndLogDebug(title, fmt.Sprintf(format, args...))
}

// IsDebug reports whether DEBUG level output is on.
func IsDebug() bool {
	return debugEnabled.Load()
}

// Debug logs message at DEBUG level under title when debug output is on.
func Debug(title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.PrintAndLogDebug(title, message)
}

// Debugf is Debug with a fmt.Sprintf style message.
func Debugf(title string, format string, args ...any) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.PrintAndLogDebug(title, fmt.Sprintf(format, args...))
}

// RequestSummary describes an HTTP request for a debug message as
// "METHOD /path", without the query string, which can carry tokens.
func RequestSummary(r *http.Request) string {
	if r == nil {
		return "<nil request>"
	}
	if r.URL == nil {
		return r.Method
	}
	return r.Method + " " + r.URL.Path
}
