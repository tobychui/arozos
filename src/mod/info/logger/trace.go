package logger

import (
	"bytes"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
	trace.go

	The function tracer behind the DEBUG level. A traced function starts with

		defer logger.Out2(logger.In2("Title", "Type.Func", "name", name, "fsh", fsh), &out0, &out1)

	and then, while debug is on, logs one line on entry with its inputs, who
	called it and from which line, and one line on return with its outputs
	and how long it took:

		g41 → FileSystemHandler.ReadFile(fsh=&FileSystemHandler{UUID:"user" ...}, rpath="a.txt") ← main.handleRead file_system.go:812
		g41 ← FileSystemHandler.ReadFile = ([]byte len=12, nil) 180µs

	Lines carry the goroutine (g41) and are indented by call depth, so the
	calls of one request can be read as a tree even when goroutines
	interleave. A panic passing through a traced function is logged where it
	happened, with the stack and the last lines of that goroutine, and every
	traced caller it unwinds through adds a line with its own inputs. The
	panic then carries on unchanged. DebugErr marks the error branches taken.
*/

// Span is one traced call. A nil Span, as returned while debug is off, does
// nothing.
type Span struct {
	title  string
	fn     string
	args   string
	gid    uint64
	depth  int
	start  time.Time
	masked bool //Handles a secret: strings in and out are not shown
}

const (
	maxDescribe  = 400 //Longest description of one value
	maxString    = 200 //Longest string shown, in runes
	maxElems     = 4   //Elements shown of a slice or map
	trailSize    = 4096
	trailOnPanic = 30
)

var (
	traceMu    sync.Mutex
	depths     = map[uint64]int{}
	reported   = map[uint64]reportedPanic{}
	trail      [trailSize]trailLine
	trailNext  int
	trailCount int
)

type reportedPanic struct {
	key  string
	when time.Time
}

type trailLine struct {
	gid  uint64
	line string
}

func enter(title, fn string, kv []any) *Span {
	s := &Span{title: title, fn: fn, gid: goroutineID(), start: time.Now()}
	s.args, s.masked = describePairs(kv, secretFunc.MatchString(fn))
	traceMu.Lock()
	s.depth = depths[s.gid]
	depths[s.gid] = s.depth + 1
	traceMu.Unlock()
	self, caller := callSite()
	msg := "→ " + fn + "(" + s.args + ")"
	if caller != "" {
		msg += " ← " + caller
	} else if self != "" {
		msg += " @ " + self
	}
	s.emit(msg)
	return s
}

func (s *Span) leave(results []any) {
	s.pop()
	msg := "← " + s.fn
	if len(results) > 0 {
		parts := make([]string, len(results))
		for i, r := range results {
			parts[i] = describeMasked(r, s.masked)
		}
		msg += " = (" + strings.Join(parts, ", ") + ")"
	}
	s.emit(msg + " " + time.Since(s.start).Round(time.Microsecond).String())
}

func (s *Span) panicked(p any) {
	s.pop()
	key := fmt.Sprint(p)
	traceMu.Lock()
	prev, seen := reported[s.gid]
	first := !seen || prev.key != key || time.Since(prev.when) > 10*time.Second
	reported[s.gid] = reportedPanic{key: key, when: time.Now()}
	traceMu.Unlock()
	if !first {
		s.emit("PANIC unwinding through " + s.fn + "(" + s.args + ")")
		return
	}
	stack := debug.Stack()
	var b strings.Builder
	b.WriteString("PANIC in " + s.fn + "(" + s.args + "): " + key)
	if loc := panicSite(stack); loc != "" {
		b.WriteString("\n    raised at " + loc)
	}
	if recent := recentLines(s.gid, trailOnPanic); len(recent) > 0 {
		b.WriteString("\n    last calls on this goroutine:")
		for _, l := range recent {
			b.WriteString("\n      " + l)
		}
	}
	b.WriteString("\n    stack:\n")
	b.Write(stack)
	s.emit(b.String())
}

func (s *Span) pop() {
	traceMu.Lock()
	if d := depths[s.gid] - 1; d > 0 {
		depths[s.gid] = d
	} else {
		delete(depths, s.gid)
	}
	traceMu.Unlock()
}

func (s *Span) emit(msg string) {
	line := "g" + strconv.FormatUint(s.gid, 10) + " " + strings.Repeat("  ", min(s.depth, 16)) + msg
	remember(s.gid, line)
	defaultLogger.PrintAndLogDebug(s.title, line)
}

// DebugErr records, while debug is on, that an error branch was taken: the
// error and the file, line and function it was handled at. Generated code
// puts it first in every `if err != nil {` block.
func DebugErr(title string, err any) {
	if !debugEnabled.Load() || isNil(err) {
		return
	}
	gid := goroutineID()
	where := ""
	if pc, file, line, ok := runtime.Caller(1); ok {
		where = shortFile(file) + ":" + strconv.Itoa(line)
		if f := runtime.FuncForPC(pc); f != nil {
			where += " in " + shortFunc(f.Name())
		}
	}
	traceMu.Lock()
	depth := depths[gid]
	traceMu.Unlock()
	line := "g" + strconv.FormatUint(gid, 10) + " " + strings.Repeat("  ", min(depth, 16)) + "! error at " + where + ": " + describe(err)
	remember(gid, line)
	defaultLogger.PrintAndLogDebug(title, line)
}

func remember(gid uint64, line string) {
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	traceMu.Lock()
	trail[trailNext] = trailLine{gid: gid, line: line}
	trailNext = (trailNext + 1) % trailSize
	if trailCount < trailSize {
		trailCount++
	}
	traceMu.Unlock()
}

// recentLines returns the last n trace lines of goroutine gid, oldest first.
func recentLines(gid uint64, n int) []string {
	traceMu.Lock()
	defer traceMu.Unlock()
	var out []string
	for i := 1; i <= trailCount && len(out) < n; i++ {
		t := trail[(trailNext-i+trailSize)%trailSize]
		if t.gid == gid {
			out = append(out, t.line)
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// goroutineID reads the id of the running goroutine from its stack header,
// "goroutine 41 [running]:". Only called while debug is on.
func goroutineID() uint64 {
	var buf [64]byte
	n := runtime.Stack(buf[:], false)
	b := bytes.TrimPrefix(buf[:n], []byte("goroutine "))
	if i := bytes.IndexByte(b, ' '); i > 0 {
		id, _ := strconv.ParseUint(string(b[:i]), 10, 64)
		return id
	}
	return 0
}

const loggerPkg = "imuslab.com/arozos/mod/info/logger."

// callSite returns the traced function's own location and the function and
// line that called it, skipping the logger's frames.
func callSite() (self string, caller string) {
	var pcs [12]uintptr
	n := runtime.Callers(2, pcs[:])
	frames := runtime.CallersFrames(pcs[:n])
	found := 0
	for {
		f, more := frames.Next()
		if !tracerFrame(f.Function) {
			loc := shortFile(f.File) + ":" + strconv.Itoa(f.Line)
			if found == 0 {
				self = loc
			} else {
				caller = shortFunc(f.Function) + " " + loc
				return
			}
			found++
		}
		if !more {
			return
		}
	}
}

// tracerFrame tells the tracer's own frames (enter and the In functions)
// from the traced function and its callers.
func tracerFrame(fn string) bool {
	rest, ok := strings.CutPrefix(fn, loggerPkg)
	if !ok {
		return false
	}
	return rest == "enter" || (len(rest) > 2 && rest[0] == 'I' && rest[1] == 'n' && rest[2] >= '0' && rest[2] <= '9')
}

// panicSite finds the first frame below the panic in a debug.Stack dump:
// the function and line that raised it, runtime frames skipped.
func panicSite(stack []byte) string {
	lines := strings.Split(string(stack), "\n")
	start := -1
	for i, l := range lines {
		if strings.HasPrefix(l, "panic(") || strings.HasPrefix(l, "runtime.gopanic(") || strings.HasPrefix(l, "runtime.sigpanic(") {
			start = i
		}
	}
	if start < 0 {
		return ""
	}
	for i := start + 2; i+1 < len(lines); i += 2 {
		fn := lines[i]
		if strings.HasPrefix(fn, "runtime.") {
			continue
		}
		file := strings.TrimSpace(lines[i+1])
		if j := strings.LastIndex(file, " +0x"); j > 0 {
			file = file[:j]
		}
		if p := strings.LastIndex(fn, "("); p > 0 {
			fn = fn[:p]
		}
		return shortFunc(fn) + " " + shortPath(file)
	}
	return ""
}

func shortFunc(name string) string {
	return strings.TrimPrefix(name, "imuslab.com/arozos/")
}

func shortFile(file string) string {
	return shortPath(file)
}

// shortPath trims a source path to the part below src/ (or the last two
// elements), which is enough to open the file.
func shortPath(file string) string {
	file = strings.ReplaceAll(file, "\\", "/")
	if i := strings.LastIndex(file, "/src/"); i >= 0 {
		return file[i+5:]
	}
	parts := strings.Split(file, "/")
	if len(parts) > 2 {
		parts = parts[len(parts)-2:]
	}
	return strings.Join(parts, "/")
}

/*
	Describing values

	Values are described for a person reading a trace: strings quoted and
	cut, structs by their identifying fields plus the pointer and interface
	fields that are nil (the usual cause of a nil pointer panic), slices and
	maps by their size and first elements. Fields and words that look like
	secrets are left out or masked. No method of an ArozOS type is called,
	so describing a value cannot take its locks or recurse into the tracer.
*/

var secretName = regexp.MustCompile(`(?i)(pass|pwd|secret|token|cred|private|privkey|apikey|salt|otp|cookie|signature|nonce|seed|hash|bearer|jwt|session|ntlm|^key$|keys$|cipher)`)

var identName = regexp.MustCompile(`(?i)^(uuid|id|name|username|user|owner|path|rpath|vpath|realpath|hierarchy|filesystem|type|kind|mode|status|state|host|hostname|port|readonly|closed|group|groups|title|slug|label|volume|node|nodeid|size|count|enabled|disabled)$`)

var secretValue = regexp.MustCompile(`(?i)((?:pass(?:word)?|pwd|token|secret|api[_-]?key|session|auth|cred[a-z]*)["']?\s*[=:]\s*["']?)([^&"'\s,;}]+)`)

// secretFunc matches functions that handle a secret: all strings going in
// and out of them are masked.
var secretFunc = regexp.MustCompile(`(?i)(pass|pwd|secret|token|cred|hash|salt|otp|cipher|crypt|seal|sign|nonce|jwt|privkey|apikey|session|ntlm|totp|Key$|Keys$|Key[A-Z]|^Key)`)

// secretKey matches lookup keys naming a secret, such as the "password"
// form field read through utils.PostPara.
var secretKey = regexp.MustCompile(`(?i)(pass|pw|secret|token|cred|otp|cookie|session|apikey|privkey|^key$|hash)`)

// describePairs formats the name and value pairs of a call. A name starting
// with "&" was passed by address; one starting with "!" names a secret
// parameter, shown as *** (a lookup key, such as key="dir", is shown, and
// when it names a secret, key="password", the outputs are masked). The other
// inputs stay visible unless masked is already true, for a function whose
// name says it handles secrets. It reports whether the outputs are masked.
func describePairs(kv []any, masked bool) (string, bool) {
	type pair struct {
		k string
		v any
	}
	var pairs []pair
	maskInputs := masked //A secret function: every string in and out
	for i := 0; i+1 < len(kv); i += 2 {
		k, _ := kv[i].(string)
		v := kv[i+1]
		secretArg := strings.HasPrefix(k, "!")
		k = strings.TrimPrefix(k, "!")
		if strings.HasPrefix(k, "&") {
			//Passed by address to avoid copying a large value
			k = k[1:]
			if rv := reflect.ValueOf(v); rv.Kind() == reflect.Pointer && !rv.IsNil() {
				v = rv.Elem().Interface()
			}
		}
		if secretArg {
			str, isStr := v.(string)
			isLookupKey := strings.EqualFold(k, "key") || strings.EqualFold(k, "keys")
			if isLookupKey && isStr && !secretKey.MatchString(str) {
				pairs = append(pairs, pair{k, v})
				continue
			}
			masked = true
			if isLookupKey && isStr {
				//Show which secret is looked up, never its value
				pairs = append(pairs, pair{k, v})
				continue
			}
			pairs = append(pairs, pair{k, hidden{}})
			continue
		}
		pairs = append(pairs, pair{k, v})
	}
	var b strings.Builder
	for i, p := range pairs {
		if i > 0 {
			b.WriteString(", ")
		}
		isLookupKey := strings.EqualFold(p.k, "key") || strings.EqualFold(p.k, "keys")
		b.WriteString(p.k + "=" + describeMasked(p.v, maskInputs && !isLookupKey))
	}
	return b.String(), masked
}

// hidden stands for a secret argument.
type hidden struct{}

// describeMasked is describe, with every string shown as *** when masked.
func describeMasked(v any, masked bool) string {
	if _, ok := v.(hidden); ok {
		return "***"
	}
	if !masked {
		return describe(v)
	}
	switch x := v.(type) {
	case nil:
		return "nil"
	case string:
		return "***(" + strconv.Itoa(len(x)) + " bytes)"
	case error:
		if isNil(x) {
			return "nil"
		}
		return "error(***)"
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Float32, reflect.Float64:
		return describe(v)
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan:
		if rv.IsNil() {
			return "nil"
		}
	}
	return "<" + typeName(rv.Type()) + " ***>"
}

func describe(v any) (out string) {
	defer func() {
		if recover() != nil {
			out = fmt.Sprintf("<%T>", v)
		}
	}()
	switch x := v.(type) {
	case nil:
		return "nil"
	case string:
		return quote(x)
	case []byte:
		if x == nil {
			return "nil"
		}
		return "[]byte len=" + strconv.Itoa(len(x))
	case *http.Request:
		return RequestSummary(x)
	case http.ResponseWriter:
		return "ResponseWriter"
	case time.Time:
		return x.Format(time.RFC3339Nano)
	case time.Duration:
		return x.String()
	case error:
		if isNil(x) {
			return "nil"
		}
		return "error(" + quote(x.Error()) + ")"
	}
	s := describeValue(reflect.ValueOf(v), 0)
	if len(s) > maxDescribe {
		s = s[:maxDescribe] + "…"
	}
	return s
}

func describeValue(v reflect.Value, depth int) string {
	if !v.IsValid() {
		return "nil"
	}
	if v.CanInterface() && depth > 0 {
		switch x := v.Interface().(type) {
		case time.Time:
			return x.Format(time.RFC3339Nano)
		case time.Duration:
			return x.String()
		case error:
			if !isNil(x) {
				return "error(" + quote(x.Error()) + ")"
			}
		}
	}
	t := v.Type()
	switch v.Kind() {
	case reflect.String:
		return quote(v.String())
	case reflect.Bool:
		return strconv.FormatBool(v.Bool())
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.FormatInt(v.Int(), 10)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return strconv.FormatUint(v.Uint(), 10)
	case reflect.Float32, reflect.Float64:
		return strconv.FormatFloat(v.Float(), 'g', -1, 64)
	case reflect.Complex64, reflect.Complex128:
		return fmt.Sprint(v.Complex())
	case reflect.Pointer:
		if v.IsNil() {
			return "nil"
		}
		if depth >= 2 {
			return "&" + typeName(t.Elem())
		}
		return "&" + describeValue(v.Elem(), depth+1)
	case reflect.Interface:
		if v.IsNil() {
			return "nil"
		}
		return describeValue(v.Elem(), depth)
	case reflect.Struct:
		if depth >= 2 {
			return typeName(t) + "{…}"
		}
		return describeStruct(v, depth)
	case reflect.Slice, reflect.Array:
		if v.Kind() == reflect.Slice && v.IsNil() {
			return "nil"
		}
		if t.Elem().Kind() == reflect.Uint8 {
			return typeName(t) + " len=" + strconv.Itoa(v.Len())
		}
		s := typeName(t) + " len=" + strconv.Itoa(v.Len())
		if depth >= 2 || v.Len() == 0 {
			return s
		}
		var parts []string
		for i := 0; i < v.Len() && i < maxElems; i++ {
			parts = append(parts, describeValue(v.Index(i), depth+1))
		}
		if v.Len() > maxElems {
			parts = append(parts, "…")
		}
		return s + " [" + strings.Join(parts, " ") + "]"
	case reflect.Map:
		if v.IsNil() {
			return "nil"
		}
		s := typeName(t) + " len=" + strconv.Itoa(v.Len())
		if depth >= 2 || v.Len() == 0 {
			return s
		}
		keys := v.MapKeys()
		names := make([]string, 0, len(keys))
		byName := map[string]reflect.Value{}
		for _, k := range keys {
			n := describeValue(k, depth+1)
			names = append(names, n)
			byName[n] = k
		}
		sort.Strings(names)
		var parts []string
		for i, n := range names {
			if i == maxElems {
				parts = append(parts, "…")
				break
			}
			if k := byName[n]; k.Kind() == reflect.String && secretName.MatchString(k.String()) {
				parts = append(parts, n+":***")
				continue
			}
			parts = append(parts, n+":"+describeValue(v.MapIndex(byName[n]), depth+1))
		}
		return s + " {" + strings.Join(parts, " ") + "}"
	case reflect.Func:
		if v.IsNil() {
			return "nil func"
		}
		return "func"
	case reflect.Chan:
		if v.IsNil() {
			return "nil chan"
		}
		return "chan len=" + strconv.Itoa(v.Len()) + "/" + strconv.Itoa(v.Cap())
	}
	return typeName(t)
}

// describeStruct shows the identifying fields of a struct (all simple fields
// of a small one) and lists the pointer, interface, map, slice, func and
// chan fields that are nil.
func describeStruct(v reflect.Value, depth int) string {
	t := v.Type()
	small := t.NumField() <= 6
	var shown, nils []string
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if f.Name == "_" || secretName.MatchString(f.Name) {
			continue
		}
		fv := v.Field(i)
		switch fv.Kind() {
		case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan:
			if fv.IsNil() {
				nils = append(nils, f.Name)
				continue
			}
			if identName.MatchString(f.Name) || (small && depth == 0) {
				shown = append(shown, f.Name+":"+describeValue(fv, depth+1))
			} else if fv.Kind() == reflect.Interface && !fv.IsNil() {
				//Which implementation sits behind an interface field
				shown = append(shown, f.Name+":"+typeName(fv.Elem().Type()))
			}
		case reflect.Struct:
			if small {
				shown = append(shown, f.Name+":"+describeValue(fv, depth+1))
			}
		default:
			if small || identName.MatchString(f.Name) {
				shown = append(shown, f.Name+":"+describeValue(fv, depth+1))
			}
		}
	}
	s := typeName(t) + "{" + strings.Join(shown, " ")
	if len(nils) > 0 {
		if len(nils) > 10 {
			nils = append(nils[:10], "…")
		}
		if len(shown) > 0 {
			s += " "
		}
		s += "nil:" + strings.Join(nils, ",")
	}
	return s + "}"
}

func typeName(t reflect.Type) string {
	s := t.String()
	if i := strings.LastIndex(s, "/"); i >= 0 {
		s = s[i+1:]
	}
	return s
}

func quote(s string) string {
	s = secretValue.ReplaceAllString(s, "${1}***")
	if r := []rune(s); len(r) > maxString {
		return strconv.Quote(string(r[:maxString])) + "…(" + strconv.Itoa(len(s)) + " bytes)"
	}
	return strconv.Quote(s)
}

// isNil also catches a nil pointer held in an interface.
func isNil(v any) bool {
	if v == nil {
		return true
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan, reflect.Interface:
		return rv.IsNil()
	}
	return false
}

// DebugValue logs a named value in the middle of a function, indented under
// the current call, while debug is on: a branch taken, a value computed, a
// user resolved. It costs nothing while debug is off.
func DebugValue[T any](title string, what string, v T) {
	if !debugEnabled.Load() {
		return
	}
	note(title, "· "+what+" = "+describe(any(v)))
}

// DebugRequest logs an incoming HTTP request (method, path without query,
// remote address) while debug is on.
func DebugRequest(title string, r *http.Request) {
	if !debugEnabled.Load() || r == nil {
		return
	}
	note(title, "» "+RequestSummary(r)+" from "+r.RemoteAddr)
}

func note(title, msg string) {
	gid := goroutineID()
	traceMu.Lock()
	depth := depths[gid]
	traceMu.Unlock()
	line := "g" + strconv.FormatUint(gid, 10) + " " + strings.Repeat("  ", min(depth, 16)) + msg
	remember(gid, line)
	defaultLogger.PrintAndLogDebug(title, line)
}
