package logger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

/*
	debug.go

	The DEBUG level. Debug lines are dropped unless debug logging was turned
	on with SetDebug (the -debug startup flag), so they cost one atomic load
	when it is off and can be left in hot paths.

	When it is on, each line also names the goroutine and the source line that
	logged it, and it is written to the log file before the call returns
	instead of in the background. A process that panics therefore still has
	its last debug lines in the file, and the lines of one request can be
	followed through the goroutine id.
*/

var debugEnabled atomic.Bool

// SetDebug turns debug logging on or off for the whole system
func SetDebug(enabled bool) {
	debugEnabled.Store(enabled)
}

// IsDebug reports whether debug logging is on. Guard debug lines that are
// costly to build with it.
func IsDebug() bool {
	return debugEnabled.Load()
}

// Debug logs a message at the DEBUG level through the default logger. It does
// nothing unless debug logging is on.
func Debug(title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.printDebug(title, message, 2)
}

// Debugf is Debug with a fmt format. The message is only formatted when debug
// logging is on.
func Debugf(title string, format string, args ...interface{}) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.printDebug(title, fmt.Sprintf(format, args...), 2)
}

// DebugfDepth is Debugf for helpers and wrappers: the line names the caller
// depth frames above the function calling DebugfDepth, so a wrapper can
// report the code that called it instead of itself. Depth 0 is Debugf.
func DebugfDepth(depth int, title string, format string, args ...interface{}) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.printDebug(title, fmt.Sprintf(format, args...), 2+depth)
}

// PrintDebug logs a message at the DEBUG level through this logger. It does
// nothing unless debug logging is on.
func (l *Logger) PrintDebug(title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	l.printDebug(title, message, 2)
}

// TracePanic logs a panic with its stack and context, then panics again with
// the same value, so the program behaves exactly as without it. Defer it
// directly at the top of a function or goroutine:
//
//	defer logger.TracePanic("Storage", "heartbeat of "+fsh.UUID)
//
// It only recovers while debug logging is on; otherwise the panic passes
// through untouched.
func TracePanic(title string, context string) {
	if !debugEnabled.Load() {
		return
	}
	r := recover()
	if r == nil {
		return
	}
	//The deferred call runs on top of the panicking frames, so this stack
	//still shows where the panic happened. Caller skips TracePanic and
	//runtime.gopanic to land on the panicking function in most cases.
	defaultLogger.printDebug(title, "PANIC in "+context+": "+fmt.Sprint(r)+"\n"+string(debug.Stack()), 3)
	panic(r)
}

// printDebug writes one debug line. skip is the number of frames between the
// caller to report and runtime.Caller.
func (l *Logger) printDebug(title string, message string, skip int) {
	caller := callerOf(skip)
	goroutine := goroutineID()
	now := time.Now()

	if l == nil {
		//Not initiated yet, just print to console
		log.Println("[DEBUG] [" + title + "] " + message + " (g" + goroutine + " " + caller + ")")
		return
	}

	if l.PrintJSON || globalPrintJSON {
		entry := jsonLogEntry{
			Time:      now.Format("2006-01-02T15:04:05.000000Z07:00"),
			Level:     "debug",
			Title:     title,
			Message:   message,
			Caller:    caller,
			Goroutine: goroutine,
		}
		if b, err := json.Marshal(entry); err == nil {
			fmt.Println(string(b))
		}
	} else {
		//Same stream and layout as the other lines of PrintAndLog
		log.Println("[DEBUG] [" + title + "] " + message + " (g" + goroutine + " " + caller + ")")
	}

	//Written in place, not in a goroutine, so it is in the file before a panic
	l.writeLine(now, title, "[DEBUG] ", message+" (g"+goroutine+" "+caller+")")
}

// callerOf returns "file.go:line" of the frame skip levels above it
func callerOf(skip int) string {
	_, file, line, ok := runtime.Caller(skip + 1)
	if !ok {
		return "?"
	}
	//The folder of the file tells packages with files of the same name apart
	return filepath.Base(filepath.Dir(file)) + "/" + filepath.Base(file) + ":" + strconv.Itoa(line)
}

// goroutineID returns the id of the running goroutine, read from the header
// of its stack ("goroutine 42 [running]:"). Only used for debug lines.
func goroutineID() string {
	buf := make([]byte, 64)
	buf = buf[:runtime.Stack(buf, false)]
	buf = bytes.TrimPrefix(buf, []byte("goroutine "))
	if i := bytes.IndexByte(buf, ' '); i > 0 {
		return string(buf[:i])
	}
	return "?"
}

// formatFileLine builds one line of the log file
func formatFileLine(t time.Time, title string, level string, message string) string {
	return t.Format("2006-01-02 15:04:05.000000") + "|" + fmt.Sprintf("%-16s", title) + " " + level + strings.TrimRight(message, "\n") + "\n"
}
