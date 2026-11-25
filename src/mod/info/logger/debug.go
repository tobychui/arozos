package logger

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"time"
)

/*
	debug.go

	The DEBUG level of the system log. Debug records are dropped unless debug
	mode is on (the -debug startup flag), so they cost one atomic load when it
	is off and can be left in hot paths.

	Debug records are made for tracing crashes, so unlike PrintAndLog they:
	  - are written to the log file before Debug returns, so the last records
	    before a panic are on disk and in the order they were logged;
	  - carry the id of the goroutine that logged them ("[g42]"), the same
	    number a panic prints in "goroutine 42 [running]:", so the trail of
	    the crashing goroutine can be picked out of the log.
*/

// debugEnabled is set once at startup via SetDebugMode.
var debugEnabled atomic.Bool

// SetDebugMode turns the DEBUG level on or off for every logger.
func SetDebugMode(enabled bool) {
	debugEnabled.Store(enabled)
}

// IsDebugMode reports whether DEBUG records are being written. Use it to skip
// building an expensive debug message.
func IsDebugMode() bool {
	return debugEnabled.Load()
}

// Debug writes a DEBUG record to the default logger when debug mode is on.
func Debug(title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.Debug(title, message)
}

// Debugf is Debug with a format string. The arguments are only formatted when
// debug mode is on.
func Debugf(title string, format string, args ...interface{}) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.Debug(title, fmt.Sprintf(format, args...))
}

// TracePanic writes a panic and the stack of the panicking goroutine to the
// system log as a DEBUG record, then lets the panic go on unchanged. Defer it
// directly (recover only works there) at the top of a goroutine or handler:
//
//	defer logger.TracePanic("Storage", "mounting "+uuid)
//
// With debug mode off it does nothing and the panic is not touched.
func TracePanic(title string, context string) {
	if !debugEnabled.Load() {
		return
	}
	r := recover()
	if r == nil {
		return
	}
	defaultLogger.Debug(title, "PANIC while "+context+": "+fmt.Sprint(r)+"\n"+string(debug.Stack()))
	panic(r)
}

// TracePanicHandler wraps h so that a panic while serving a request is written
// to the system log with its stack, the same as TracePanic, before net/http
// deals with it as it always does (it logs the panic to stderr and drops the
// connection). http.ErrAbortHandler, the deliberate way to abort a response,
// is not logged. With debug mode off h is returned unchanged.
func TracePanicHandler(title string, h http.Handler) http.Handler {
	if !debugEnabled.Load() {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v != http.ErrAbortHandler {
				defaultLogger.Debug(title, "PANIC while serving "+r.Method+" "+r.URL.Path+": "+fmt.Sprint(v)+"\n"+string(debug.Stack()))
			}
			panic(v)
		}()
		h.ServeHTTP(w, r)
	})
}

// Debug writes a DEBUG record when debug mode is on. The file line is written
// before Debug returns.
func (l *Logger) Debug(title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	message = "[g" + goroutineID() + "] " + message
	if l == nil {
		consolePrint(title, "debug", message, false)
		return
	}
	l.writeLine(title, "[DEBUG]", message)
	consolePrint(title, "debug", message, l.PrintJSON)
}

// EnableCrashLog makes the Go runtime also write its crash report (the panic
// value and the stack of every goroutine) to <prefix>_crash.log in the log
// folder when the process dies. That covers what TracePanic cannot: a panic in
// a goroutine nobody wrapped, and fatal errors such as "concurrent map writes"
// that cannot be recovered at all. The report still goes to stderr as well.
// It returns the path of the crash log.
func (l *Logger) EnableCrashLog() (string, error) {
	if l == nil || l.LogFolder == "" {
		return "", fmt.Errorf("logger has no log folder")
	}
	crashLogPath := filepath.Join(l.LogFolder, l.Prefix+"_crash.log")
	f, err := os.OpenFile(crashLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return "", err
	}
	defer f.Close() //SetCrashOutput keeps its own duplicate of the file
	f.WriteString("==== ArozOS started " + time.Now().Format("2006-01-02 15:04:05.000000") + " (pid " + fmt.Sprint(os.Getpid()) + "), a crash report below this line belongs to this run ====\n")
	err = debug.SetCrashOutput(f, debug.CrashOptions{})
	if err != nil {
		return "", err
	}
	return crashLogPath, nil
}

// goroutineID returns the id of the calling goroutine, as printed in the
// first line of its stack ("goroutine 42 [running]:").
func goroutineID() string {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	s := strings.TrimPrefix(string(buf[:n]), "goroutine ")
	if i := strings.IndexByte(s, ' '); i > 0 {
		return s[:i]
	}
	return "?"
}
