package logger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
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
	fileMu         sync.Mutex
}

type jsonLogEntry struct {
	Time      string `json:"time"`
	Level     string `json:"level"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	Caller    string `json:"caller,omitempty"`    //Debug lines only: file:line that logged
	Goroutine string `json:"goroutine,omitempty"` //Debug lines only: id of the goroutine that logged
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
	if originalError == nil {
		l.writeLine(time.Now(), title, "[INFO]", errorMessage)
	} else {
		l.writeLine(time.Now(), title, "[ERROR]", errorMessage+" "+originalError.Error())
	}
}

// writeLine appends one line to the log file, if this logger has one. Lines
// are written one at a time, so lines logged at once do not interleave.
func (l *Logger) writeLine(t time.Time, title string, level string, message string) {
	if l == nil {
		return
	}
	l.fileMu.Lock()
	defer l.fileMu.Unlock()
	if !l.LogToFile || l.file == nil {
		return
	}
	l.ValidateAndUpdateLogFilepath()
	if !l.LogToFile {
		return
	}
	l.file.WriteString(formatFileLine(t, title, level, message))
}

// Validate if the logging target is still valid (detect any months change)
func (l *Logger) ValidateAndUpdateLogFilepath() {
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
	l.fileMu.Lock()
	defer l.fileMu.Unlock()
	if l.file != nil {
		l.file.Close()
	}
}

/*
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
