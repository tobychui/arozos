package logger

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type traceFixture struct {
	UUID     string
	Name     string
	Path     string
	Password string
	Backend  interface{ Close() error }
	Parent   *traceFixture
	Count    int
	Extra    map[string]int
	More     []string
}

func tracedDivide(a, b int) (out0 int, out1 error) {
	defer Out2(In2("Test", "tracedDivide", "a", a, "b", b), &out0, &out1)
	if b == 0 {
		return 0, errors.New("division by zero")
	}
	return a / b, nil
}

func tracedNilDeref(f *traceFixture) (out0 string) {
	defer Out1(In1("Test", "tracedNilDeref", "f", f), &out0)
	return f.Parent.Name //panics when Parent is nil
}

func tracedOuter(f *traceFixture) (out0 string) {
	defer Out1(In1("Test", "tracedOuter", "f", f), &out0)
	return tracedNilDeref(f)
}

func TestTraceOffIsFree(t *testing.T) {
	withDebug(t, false)
	path := "some/path"
	f := &traceFixture{}
	allocs := testing.AllocsPerRun(100, func() {
		var out0 int
		var out1 error
		func() {
			defer Out2(In3("Test", "F", "path", path, "f", f, "n", 3), &out0, &out1)
		}()
	})
	if allocs != 0 {
		t.Fatalf("a traced call allocates %v times while debug is off", allocs)
	}
	if In0("Test", "F") != nil {
		t.Fatalf("In0 returned a span while debug is off")
	}
}

func TestTraceInputsAndOutputs(t *testing.T) {
	withDebug(t, true)
	tests := []struct {
		name string
		call func()
		want []string
	}{
		{"result", func() { tracedDivide(6, 3) }, []string{"→ tracedDivide(a=6, b=3) ← ", "trace_test.go:", "← tracedDivide = (2, nil)"}},
		{"error result", func() { tracedDivide(1, 0) }, []string{`← tracedDivide = (0, error("division by zero"))`}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := captureStd(t, tt.call)
			for _, w := range tt.want {
				if !strings.Contains(out, w) {
					t.Errorf("output lacks %q:\n%s", w, out)
				}
			}
		})
	}
}

func TestTracePanicIsReportedAndRaisedAgain(t *testing.T) {
	withDebug(t, true)
	var caught any
	out := captureStd(t, func() {
		defer func() { caught = recover() }()
		tracedOuter(&traceFixture{UUID: "user", Name: "User"})
	})
	if caught == nil {
		t.Fatalf("the panic did not reach the caller")
	}
	for _, w := range []string{
		"PANIC in tracedNilDeref(f=&logger.traceFixture{",
		`UUID:"user"`,
		"nil:Backend,Parent",
		"invalid memory address",
		"raised at mod/info/logger.tracedNilDeref mod/info/logger/trace_test.go:",
		"last calls on this goroutine:",
		"PANIC unwinding through tracedOuter(",
	} {
		if !strings.Contains(out, w) {
			t.Errorf("output lacks %q:\n%s", w, out)
		}
	}
	if strings.Count(out, "stack:") != 1 {
		t.Errorf("want the stack once, at the innermost frame:\n%s", out)
	}
}

func TestDebugErr(t *testing.T) {
	withDebug(t, true)
	out := captureStd(t, func() {
		DebugErr("Test", errors.New("disk gone"))
		DebugErr("Test", nil)
		var typedNil *traceFixture
		DebugErr("Test", typedNil)
	})
	if !strings.Contains(out, `! error at mod/info/logger/trace_test.go:`) || !strings.Contains(out, `error("disk gone")`) {
		t.Errorf("unexpected output %q", out)
	}
	if strings.Count(out, "! error") != 1 {
		t.Errorf("nil errors must not be logged: %q", out)
	}
}

func TestDescribe(t *testing.T) {
	long := strings.Repeat("x", 300)
	tests := []struct {
		name  string
		value any
		want  []string
		never []string
	}{
		{"string", "a.txt", []string{`"a.txt"`}, nil},
		{"long string", long, []string{"…(300 bytes)"}, nil},
		{"secret in query", "/api?token=abc123&x=1", []string{"token=***"}, []string{"abc123"}},
		{"secret in json", `{"password":"hunter2"}`, []string{`password`, `***`}, []string{"hunter2"}},
		{"nil pointer", (*traceFixture)(nil), []string{"nil"}, nil},
		{"struct", &traceFixture{UUID: "u1", Name: "n", Password: "pw", More: []string{"a", "b"}}, []string{`UUID:"u1"`, "nil:Backend,Parent,Extra"}, []string{"pw", "Password"}},
		{"slice", []string{"a", "b", "c", "d", "e"}, []string{`[]string len=5 ["a" "b" "c" "d" …]`}, nil},
		{"bytes", []byte("secret file content"), []string{"[]byte len=19"}, []string{"content"}},
		{"map", map[string]int{"b": 2, "a": 1, "token": 9}, []string{"len=3", `"a":1`, `"b":2`, `"token":***`}, []string{"9"}},
		{"error", errors.New("boom"), []string{`error("boom")`}, nil},
		{"nil error", error(nil), []string{"nil"}, nil},
		{"func", func() {}, []string{"func"}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := describe(tt.value)
			for _, w := range tt.want {
				if !strings.Contains(got, w) {
					t.Errorf("describe = %q, want it to contain %q", got, w)
				}
			}
			for _, n := range tt.never {
				if strings.Contains(got, n) {
					t.Errorf("describe = %q, must not contain %q", got, n)
				}
			}
		})
	}
}

func TestDescribePairsByAddress(t *testing.T) {
	big := traceFixture{UUID: "by-address"}
	got, _ := describePairs([]any{"&opt", &big, "n", 2}, false)
	if !strings.HasPrefix(got, `opt=logger.traceFixture{UUID:"by-address"`) || !strings.HasSuffix(got, "n=2") {
		t.Errorf("got %q", got)
	}
}

func TestTraceDepthIndents(t *testing.T) {
	withDebug(t, true)
	out := captureStd(t, func() { tracedOuter(&traceFixture{Parent: &traceFixture{Name: "p"}}) })
	if !strings.Contains(out, "→ tracedOuter(") || !strings.Contains(out, "   → tracedNilDeref(") {
		t.Errorf("inner call is not indented:\n%s", out)
	}
	if !strings.Contains(out, `← tracedOuter = ("p")`) {
		t.Errorf("missing outer result:\n%s", out)
	}
}

func TestDebugValueAndRequest(t *testing.T) {
	withDebug(t, false)
	allocs := testing.AllocsPerRun(100, func() {
		DebugValue("Test", "user", "alice")
		DebugRequest("Test", nil)
	})
	if allocs != 0 {
		t.Fatalf("DebugValue allocates %v times while debug is off", allocs)
	}
	SetDebug(true)
	r := httptest.NewRequest("GET", "/system/file_system/listDir?dir=user:/&token=abc", nil)
	out := captureStd(t, func() {
		DebugValue("Test", "user", "alice")
		DebugRequest("Test", r)
	})
	for _, w := range []string{`· user = "alice"`, "» GET /system/file_system/listDir from 192.0.2.1:1234"} {
		if !strings.Contains(out, w) {
			t.Errorf("output lacks %q:\n%s", w, out)
		}
	}
	if strings.Contains(out, "abc") {
		t.Errorf("query string leaked: %s", out)
	}
}

func tracedLookup(key string, value string) (out0 string) {
	defer Out1(In1("Test", "PostPara", "!key", key), &out0)
	return value
}

func tracedLogin(username, password string) (out0 bool) {
	defer Out1(In2("Test", "Login", "username", username, "!password", password), &out0)
	return password != ""
}

func tracedHash(raw string) (out0 string) {
	defer Out1(In1("Test", "Hash", "raw", raw), &out0)
	return "digest-of-" + raw
}

func TestTraceMasksSecrets(t *testing.T) {
	withDebug(t, true)
	tests := []struct {
		name  string
		call  func()
		want  []string
		never []string
	}{
		{"plain lookup shown", func() { tracedLookup("dir", "user:/Photos") }, []string{`key="dir"`, `= ("user:/Photos")`}, nil},
		{"secret lookup masked", func() { tracedLookup("password", "hunter2") }, []string{`key="password"`, "= (***(7 bytes))"}, []string{"hunter2"}},
		{"secret parameter", func() { tracedLogin("alice", "hunter2") }, []string{`username="alice"`, "password=***", "= (true)"}, []string{"hunter2"}},
		{"secret function", func() { tracedHash("hunter2") }, []string{"raw=***(7 bytes)"}, []string{"hunter2"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := captureStd(t, tt.call)
			for _, w := range tt.want {
				if !strings.Contains(out, w) {
					t.Errorf("output lacks %q:\n%s", w, out)
				}
			}
			for _, n := range tt.never {
				if strings.Contains(out, n) {
					t.Errorf("output leaks %q:\n%s", n, out)
				}
			}
		})
	}
}

func TestDescribePairsSecretByAddress(t *testing.T) {
	cfg := traceFixture{Name: "smtp"}
	got, masked := describePairs([]any{"!&cred", &cfg, "n", 1}, false)
	if got != "cred=***, n=1" || !masked {
		t.Errorf("got %q masked=%t", got, masked)
	}
}
