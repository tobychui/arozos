package logger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

/*
	ArozOS System Logger

	This script is designed to make a managed log for the ArozOS system
	and replace the ton of log.Println in the system core
*/

// globalPrintJSON is set once at startup via SetGlobalJSONOutput.
var globalPrintJSON bool

func SetGlobalJSONOutput(enabled bool) {
	globalPrintJSON = enabled
}

// defaultLogger is the single system-wide logger used by all packages.
// It starts as a tmp (stdout-only) logger and is replaced by SetDefaultLogger
// once the real logger is ready in main().
var defaultLogger, _ = NewTmpLogger()

// SetDefaultLogger replaces the default logger used by all packages.
// Call this once in main() after the persistent logger is created.
func SetDefaultLogger(l *Logger) {
	defaultLogger = l
}

// PrintAndLog is a package-level convenience function that delegates to the
// default logger. All modules should call this instead of keeping their own
// logger instances.
func PrintAndLog(title string, message string, originalError error) {
	defaultLogger.PrintAndLog(title, message, originalError)
}

type Logger struct {
	LogToFile      bool     //Set enable write to file
	PrintJSON      bool     //Print console output as JSON lines instead of plain text
	Prefix         string   //Prefix for log files
	LogFolder      string   //Folder to store the log  file
	CurrentLogFile string   //Current writing filename
	file           *os.File //File, empty if LogToFile is false
	mu             sync.Mutex
}

type jsonLogEntry struct {
	Time      string `json:"time"`
	Level     string `json:"level"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	Goroutine uint64 `json:"goroutine,omitempty"` //Debug lines only
	Caller    string `json:"caller,omitempty"`    //Debug lines only
}

// Create a default logger
func NewLogger(logFilePrefix string, logFolder string, logToFile bool) (*Logger, error) {
	if logToFile {
		err := os.MkdirAll(logFolder, 0775)
		if err != nil {
			return nil, err
		}
	}

	thisLogger := Logger{
		LogToFile: logToFile,
		Prefix:    logFilePrefix,
		LogFolder: logFolder,
	}

	if logToFile {
		logFilePath := thisLogger.getLogFilepath()
		f, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0755)
		if err != nil {
			return nil, err
		}
		thisLogger.CurrentLogFile = logFilePath
		thisLogger.file = f
	}

	return &thisLogger, nil
}

// Create a non-persistent logger for one-time uses
func NewTmpLogger() (*Logger, error) {
	return NewLogger("", "", false)
}

func (l *Logger) getLogFilepath() string {
	year, month, _ := time.Now().Date()
	return filepath.Join(l.LogFolder, l.Prefix+"_"+strconv.Itoa(year)+"-"+strconv.Itoa(int(month))+".log")
}

// PrintAndLog will log the message to file and print the log to STDOUT
func (l *Logger) PrintAndLog(title string, message string, originalError error) {
	if l == nil {
		// Not initiated yet, just print to console
		log.Println("[" + title + "] " + message)
		return
	}
	go func() {
		l.Log(title, message, originalError)
	}()
	if l.PrintJSON || globalPrintJSON {
		level := "info"
		if originalError != nil {
			level = "error"
		}
		entry := jsonLogEntry{
			Time:    time.Now().Format("2006-01-02T15:04:05.000000Z07:00"),
			Level:   level,
			Title:   title,
			Message: message,
		}
		b, err := json.Marshal(entry)
		if err != nil {
			log.Println("[" + title + "] " + message)
			return
		}
		fmt.Println(string(b))
	} else {
		log.Println("[" + title + "] " + message)
	}
}

func (l *Logger) Log(title string, errorMessage string, originalError error) {
	if l != nil && l.LogToFile {
		//INFO and ERROR lines are written from their own goroutines and
		//DEBUG lines from the caller's, so writes and the monthly file
		//change take turns
		l.mu.Lock()
		defer l.mu.Unlock()
		l.validateAndUpdateLogFilepath()
		if l.file == nil {
			return
		}
		if originalError == nil {
			l.file.WriteString(time.Now().Format("2006-01-02 15:04:05.000000") + "|" + fmt.Sprintf("%-16s", title) + " [INFO]" + errorMessage + "\n")
		} else {
			l.file.WriteString(time.Now().Format("2006-01-02 15:04:05.000000") + "|" + fmt.Sprintf("%-16s", title) + " [ERROR]" + errorMessage + " " + originalError.Error() + "\n")
		}
	}

}

// Validate if the logging target is still valid (detect any months change)
func (l *Logger) ValidateAndUpdateLogFilepath() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.validateAndUpdateLogFilepath()
}

// validateAndUpdateLogFilepath is ValidateAndUpdateLogFilepath for callers
// holding l.mu
func (l *Logger) validateAndUpdateLogFilepath() {
	expectedCurrentLogFilepath := l.getLogFilepath()
	if l.CurrentLogFile != expectedCurrentLogFilepath {
		//Change of month. Update to a new log file
		l.file.Close()
		f, err := os.OpenFile(expectedCurrentLogFilepath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0755)
		if err != nil {
			log.Println("[Logger] Unable to create new log. Logging to file disabled.")
			l.LogToFile = false
			return
		}
		l.CurrentLogFile = expectedCurrentLogFilepath
		l.file = f
	}
}

func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.file.Close()
}

/*
	DEBUG level

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
// It does nothing unless debug is enabled. Its arguments are still evaluated
// when debug is off (a built message, the values boxed for Debugf), so a
// line on a path that runs per file or per request goes behind
// DebugEnabled().
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

// DebugDepth is Debug for logging helpers: the line it names is depth frames
// above the caller of DebugDepth, so a helper that wraps it passes 1 and the
// line shown is the one that called the helper.
func DebugDepth(depth int, title string, message string) {
	if !debugEnabled.Load() {
		return
	}
	defaultLogger.writeDebug(title, message, callerOf(2+depth), goroutineID())
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

	defer logger.TracePanic("Storage", "running the drive heartbeat")

since recover only works in the deferred function itself. during says what
the function was doing, and is written next to the panic. When debug is off
it does not recover anything.

during is evaluated at the defer statement, debug or not, so give it a
constant. A description built from variables goes through TracePanicFunc.
*/
func TracePanic(title string, during string) {
	if !debugEnabled.Load() {
		return
	}
	r := recover()
	if r == nil {
		return
	}
	logPanic(title, during, r)
	panic(r)
}

/*
TracePanicFunc is TracePanic for a description built from variables:

	defer logger.TracePanicFunc("SMB", func() string { return "opening " + p + " on " + s.name() })

describe is only called when a panic is being logged, so a call that does
not panic, or runs with debug off, builds no string, and a nil field it
reads cannot panic at the defer statement. A describe that panics itself
is reported in its place instead of hiding the panic being traced. Defer it
directly, like TracePanic.
*/
func TracePanicFunc(title string, describe func() string) {
	if !debugEnabled.Load() {
		return
	}
	r := recover()
	if r == nil {
		return
	}
	logPanic(title, describeSafely(describe), r)
	panic(r)
}

// describeSafely calls a TracePanicFunc description, which runs while a
// panic is being handled and so must not panic again
func describeSafely(describe func() string) (during string) {
	defer func() {
		if r := recover(); r != nil {
			during = fmt.Sprintf("<description failed: %v>", r)
		}
	}()
	if describe == nil {
		return "<no description>"
	}
	return describe()
}

// logPanic writes a recovered panic and the stack of its goroutine
func logPanic(title string, during string, r any) {
	//The stack names the line that panicked; the caller of a deferred
	//function at this point is the runtime, so none is given
	message := fmt.Sprintf("PANIC while %s: %v\n%s", during, r, debug.Stack())
	defaultLogger.writeDebug(title, message, "", goroutineID())
}

/*
TracePanicHandler wraps h so that a panic while serving a request is logged
with its stack, the same as TracePanic, before net/http deals with it as it
always does (it logs the panic to stderr and drops the connection).
http.ErrAbortHandler, the deliberate way to abort a response, is not logged.
When debug is off h is returned unchanged.
*/
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
				message := fmt.Sprintf("PANIC while serving %s %s: %v\n%s", r.Method, r.URL.Path, v, debug.Stack())
				defaultLogger.writeDebug(title, message, "", goroutineID())
			}
			panic(v)
		}()
		h.ServeHTTP(w, r)
	})
}

// crashLogMaxBytes is the size past which the crash log is moved aside at
// startup, keeping one older file
const crashLogMaxBytes = 5 << 20

/*
EnableCrashLog makes the Go runtime also write its crash report to
<prefix>_crash.log in the log folder when the process dies. That covers what
TracePanic cannot: a panic in a goroutine nobody wrapped, and fatal errors
such as "concurrent map writes" that cannot be recovered at all. The report
still goes to stderr as well. It returns the path of the crash log.

The runtime only prints the crashing goroutine by default (GOTRACEBACK), so
this also asks for the stack of every goroutine: what the others were doing
is often what explains the crash. A GOTRACEBACK set higher in the
environment stays in force.

Each start adds one marker line, and each crash one report, so the file only
grows by crashes; still, a crash log over crashLogMaxBytes is moved to
<prefix>_crash.log.1 (replacing an older one) before it is opened.
*/
func (l *Logger) EnableCrashLog() (string, error) {
	if l == nil || l.LogFolder == "" {
		return "", fmt.Errorf("logger has no log folder")
	}
	crashLogPath := filepath.Join(l.LogFolder, l.Prefix+"_crash.log")
	if info, err := os.Stat(crashLogPath); err == nil && info.Size() > crashLogMaxBytes {
		if err := os.Rename(crashLogPath, crashLogPath+".1"); err != nil {
			return "", err
		}
	}
	f, err := os.OpenFile(crashLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return "", err
	}
	defer f.Close() //SetCrashOutput keeps its own duplicate of the file
	f.WriteString("==== ArozOS started " + time.Now().Format("2006-01-02 15:04:05.000000") + " (pid " + strconv.Itoa(os.Getpid()) + "), a crash report below this line belongs to this run ====\n")
	if err := debug.SetCrashOutput(f, debug.CrashOptions{}); err != nil {
		return "", err
	}
	debug.SetTraceback("all")
	return crashLogPath, nil
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
