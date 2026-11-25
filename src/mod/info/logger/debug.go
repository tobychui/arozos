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

	The DEBUG log level. It is off unless the -debug start flag is given
	(SetDebug), and then it is printed and written to the system log like
	any other line, marked [DEBUG].

	Debug lines are meant for tracing crashes, so they differ from INFO and
	ERROR lines in two ways:

	- They are written to the log file synchronously, in the calling
	  goroutine, so the last lines before a panic are on disk even when the
	  process dies right after.
	- Each line names the goroutine and the source line that logged it, as
	  "(goroutine 42, storage/storage.go:57)". A panic trace starts with
	  "goroutine 42 [running]:", so searching the log for "goroutine 42"
	  shows what that goroutine was doing before it crashed.
*/

// debugEnabled holds the -debug start flag
var debugEnabled atomic.Bool

// SetDebug turns DEBUG level messages on or off. main calls it once with
// the -debug start flag.
func SetDebug(enabled bool) {
	debugEnabled.Store(enabled)
}

// DebugEnabled reports whether DEBUG level messages are printed and logged.
// Check it before building a debug message that is expensive to make.
func DebugEnabled() bool {
	return debugEnabled.Load()
}

// Debug prints and logs a DEBUG level message through the system logger.
// It does nothing unless debug is enabled.
func Debug(title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.writeDebug(title, message, callerOf(2), goroutineID())
}

// Debugf is Debug with a fmt.Sprintf format. The message is only formatted
// when debug is enabled.
func Debugf(title string, format string, args ...any) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.writeDebug(title, fmt.Sprintf(format, args...), callerOf(2), goroutineID())
}

// Debug prints and logs a DEBUG level message to this logger. It does
// nothing unless debug is enabled.
func (l *Logger) Debug(title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	l.writeDebug(title, message, callerOf(2), goroutineID())
}

/*
TracePanic logs a panic with its stack when debug is enabled, then panics
again with the same value, so the program behaves as it would without it
(net/http still recovers a panicking handler, a panicking goroutine still
stops the program). Defer it directly, as

	defer logger.TracePanic("Storage", "loading the storage pool of "+group)

since recover only works in the deferred function itself. during says what
the function was doing, and is written next to the panic. When debug is off
it does not recover anything.
*/
func TracePanic(title string, during string) {
	if !debugEnabled.Load() {
		return
	}
	r := recover()
	if r == nil {
		return
	}
	//The stack names the line that panicked; the caller of a deferred
	//function at this point is the runtime, so none is given
	message := fmt.Sprintf("PANIC while %s: %v\n%s", during, r, debug.Stack())
	defaultLogger.writeDebug(title, message, "", goroutineID())
	panic(r)
}

// writeDebug prints a debug line to STDOUT and writes it to the log file,
// both before it returns
func (l *Logger) writeDebug(title string, message string, caller string, goroutine uint64) {
	where := debugLocation(caller, goroutine)
	if l == nil {
		log.Println("[" + title + "] [DEBUG] " + message + " " + where)
		return
	}

	l.logDebug(title, message+" "+where)
	if l.PrintJSON || globalPrintJSON {
		entry := jsonLogEntry{
			Time:      time.Now().Format("2006-01-02T15:04:05.000000Z07:00"),
			Level:     "debug",
			Title:     title,
			Message:   message,
			Goroutine: goroutine,
			Caller:    caller,
		}
		b, err := json.Marshal(entry)
		if err == nil {
			fmt.Println(string(b))
			return
		}
	}
	log.Println("[" + title + "] [DEBUG] " + message + " " + where)
}

// logDebug writes a debug line to the log file, if the logger has one
func (l *Logger) logDebug(title string, message string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.LogToFile {
		return
	}
	l.validateAndUpdateLogFilepath()
	if l.file != nil {
		l.file.WriteString(time.Now().Format("2006-01-02 15:04:05.000000") + "|" + fmt.Sprintf("%-16s", title) + " [DEBUG]" + message + "\n")
	}
}

// debugLocation formats the goroutine and the source line of a debug line
func debugLocation(caller string, goroutine uint64) string {
	if caller == "" {
		return "(goroutine " + strconv.FormatUint(goroutine, 10) + ")"
	}
	return "(goroutine " + strconv.FormatUint(goroutine, 10) + ", " + caller + ")"
}

// callerOf returns the file and line skip frames above it, as
// "folder/file.go:line": the folder tells same named files apart
func callerOf(skip int) string {
	_, file, line, ok := runtime.Caller(skip)
	if !ok {
		return ""
	}
	return shortCaller(file, line)
}

// shortCaller keeps the last folder and the file name of a source path
func shortCaller(file string, line int) string {
	file = filepath.ToSlash(file)
	if i := strings.LastIndex(file, "/"); i >= 0 {
		if j := strings.LastIndex(file[:i], "/"); j >= 0 {
			file = file[j+1:]
		}
	}
	return file + ":" + strconv.Itoa(line)
}

// goroutineID returns the number Go prints for the calling goroutine in a
// panic trace ("goroutine 42 [running]:"), or 0 if it cannot be read
func goroutineID() uint64 {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	return parseGoroutineID(buf[:n])
}

// parseGoroutineID reads the number from the first line of a stack trace
func parseGoroutineID(stack []byte) uint64 {
	stack, found := bytes.CutPrefix(stack, []byte("goroutine "))
	if !found {
		return 0
	}
	end := bytes.IndexByte(stack, ' ')
	if end < 0 {
		return 0
	}
	id, err := strconv.ParseUint(string(stack[:end]), 10, 64)
	if err != nil {
		return 0
	}
	return id
}
