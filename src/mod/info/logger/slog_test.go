package logger

import (
	"context"
	"errors"
	"log/slog"
	"testing"
)

type slogLine struct {
	title, message string
	err            error
}

// captureSlog returns a logger whose records are kept instead of printed.
func captureSlog(title string) (*slog.Logger, *[]slogLine) {
	lines := &[]slogLine{}
	h := &slogHandler{title: title, emit: func(title, message string, err error) {
		*lines = append(*lines, slogLine{title, message, err})
	}}
	return slog.New(h), lines
}

// TestSlogMessages checks how records become PrintAndLog calls.
func TestSlogMessages(t *testing.T) {
	bad := errors.New("port in use")
	tests := []struct {
		name    string
		log     func(l *slog.Logger)
		message string
		err     error
	}{
		{"plain", func(l *slog.Logger) { l.Info("Listening on :445") }, "Listening on :445", nil},
		{"component dropped", func(l *slog.Logger) { l.Info("Listening", "component", "smbsrv") }, "Listening", nil},
		{"error passed on", func(l *slog.Logger) { l.Warn("Accept failed", "component", "smbsrv", "err", bad) }, "Accept failed", bad},
		{"other attributes", func(l *slog.Logger) { l.Info("Login", "user", "alice", "n", 2) }, "Login user=alice n=2", nil},
		{"quoted values", func(l *slog.Logger) { l.Info("Login", "from", "a b", "empty", "") }, `Login from="a b" empty=""`, nil},
		{"second error kept", func(l *slog.Logger) { l.Warn("x", "err", bad, "cause", errors.New("eof")) }, "x cause=eof", bad},
		{"with attrs", func(l *slog.Logger) { l.With("share", "photos").Info("Opened") }, "Opened share=photos", nil},
		{"with group", func(l *slog.Logger) { l.WithGroup("req").Info("Read", "size", 4) }, "Read req.size=4", nil},
		{"group attr", func(l *slog.Logger) { l.Info("Read", slog.Group("req", "size", 4)) }, "Read req.size=4", nil},
		{"group then attrs", func(l *slog.Logger) { l.WithGroup("g").With("a", 1).Info("m", "b", 2) }, "m g.a=1 g.b=2", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l, lines := captureSlog("SMB")
			tt.log(l)
			if len(*lines) != 1 {
				t.Fatalf("got %d lines, want 1", len(*lines))
			}
			got := (*lines)[0]
			if got.title != "SMB" {
				t.Errorf("title = %q, want SMB", got.title)
			}
			if got.message != tt.message {
				t.Errorf("message = %q, want %q", got.message, tt.message)
			}
			if got.err != tt.err {
				t.Errorf("err = %v, want %v", got.err, tt.err)
			}
		})
	}
}

// TestSlogDropsDebug checks that debug records never reach the system log
// while debug mode is off.
func TestSlogDropsDebug(t *testing.T) {
	SetDebugMode(false)
	l, lines := captureSlog("WSD")
	l.Debug("noise")
	if len(*lines) != 0 {
		t.Errorf("debug record logged: %v", *lines)
	}
	if l.Handler().Enabled(context.Background(), slog.LevelDebug) {
		t.Error("debug should be disabled")
	}
	if !l.Handler().Enabled(context.Background(), slog.LevelWarn) {
		t.Error("warn should be enabled")
	}
}

// TestNewSlog checks that the exported constructor writes to the system log.
func TestNewSlog(t *testing.T) {
	l := NewSlog("SMB")
	h, ok := l.Handler().(*slogHandler)
	if !ok {
		t.Fatalf("handler is %T", l.Handler())
	}
	if h.title != "SMB" || h.emit == nil || h.debug == nil {
		t.Errorf("handler not set up: %+v", h)
	}
	l.Info("written through PrintAndLog")
}
