package logger

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
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
}

type jsonLogEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Title   string `json:"title"`
	Message string `json:"message"`
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
		l.ValidateAndUpdateLogFilepath()
		if originalError == nil {
			l.file.WriteString(time.Now().Format("2006-01-02 15:04:05.000000") + "|" + fmt.Sprintf("%-16s", title) + " [INFO]" + errorMessage + "\n")
		} else {
			l.file.WriteString(time.Now().Format("2006-01-02 15:04:05.000000") + "|" + fmt.Sprintf("%-16s", title) + " [ERROR]" + errorMessage + " " + originalError.Error() + "\n")
		}
	}

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
	l.file.Close()
}
