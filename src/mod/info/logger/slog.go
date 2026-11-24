package logger

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

/*
	slog.go

	A log/slog handler that writes to the system log, for libraries that take
	a *slog.Logger (such as github.com/tobychui/smbsrv) instead of calling
	PrintAndLog themselves.
*/

// NewSlog returns a *slog.Logger whose records go to PrintAndLog under title.
// Debug records are dropped. The first attribute holding an error is passed
// as the error, the others are added to the message as key=value. A
// "component" attribute is left out, because the title already names the
// part of the system that logged.
func NewSlog(title string) *slog.Logger {
	return slog.New(&slogHandler{title: title, emit: PrintAndLog})
}

type slogHandler struct {
	title  string
	emit   func(title string, message string, originalError error)
	prefix string      //Group prefix of later attributes, such as "req."
	attrs  []slog.Attr //Attributes added by WithAttrs, keys already prefixed
}

func (h *slogHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= slog.LevelInfo
}

func (h *slogHandler) Handle(_ context.Context, r slog.Record) error {
	var b strings.Builder
	b.WriteString(r.Message)
	var origErr error
	for _, a := range h.attrs {
		//Keys of these were prefixed when they were added
		origErr = appendAttr(&b, a, "", origErr)
	}
	r.Attrs(func(a slog.Attr) bool {
		origErr = appendAttr(&b, a, h.prefix, origErr)
		return true
	})
	h.emit(h.title, b.String(), origErr)
	return nil
}

func (h *slogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := *h
	next.attrs = append([]slog.Attr{}, h.attrs...)
	for _, a := range attrs {
		a.Key = h.prefix + a.Key
		next.attrs = append(next.attrs, a)
	}
	return &next
}

func (h *slogHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	next := *h
	next.prefix = h.prefix + name + "."
	return &next
}

// appendAttr writes one attribute to the message and returns the error to
// log, which is the first error value seen.
func appendAttr(b *strings.Builder, a slog.Attr, prefix string, origErr error) error {
	a.Value = a.Value.Resolve()
	if a.Equal(slog.Attr{}) {
		return origErr
	}
	if a.Value.Kind() == slog.KindGroup {
		inner := prefix
		if a.Key != "" {
			inner = prefix + a.Key + "."
		}
		for _, g := range a.Value.Group() {
			origErr = appendAttr(b, g, inner, origErr)
		}
		return origErr
	}
	key := prefix + a.Key
	if key == "component" {
		return origErr
	}
	if err, ok := a.Value.Any().(error); ok && a.Value.Kind() == slog.KindAny && origErr == nil {
		return err
	}
	value := a.Value.String()
	if value == "" || strings.ContainsAny(value, " \t\n\"=") {
		value = fmt.Sprintf("%q", value)
	}
	b.WriteString(" " + key + "=" + value)
	return origErr
}
