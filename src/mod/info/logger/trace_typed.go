package logger

/*
	trace_typed.go

	The typed entry (In0 to In8) and exit (Out0 to Out4) points of the
	function tracer in trace.go. Generic parameters instead of ...any keep a
	call free of allocations while debug is off: values are only boxed once
	the debug check has passed.
*/

// In0 starts the trace of a call with 0 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In0(title string, fn string) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{})
}

// In1 starts the trace of a call with 1 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In1[A any](title string, fn string, k1 string, v1 A) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1})
}

// In2 starts the trace of a call with 2 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In2[A, B any](title string, fn string, k1 string, v1 A, k2 string, v2 B) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1, k2, v2})
}

// In3 starts the trace of a call with 3 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In3[A, B, C any](title string, fn string, k1 string, v1 A, k2 string, v2 B, k3 string, v3 C) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1, k2, v2, k3, v3})
}

// In4 starts the trace of a call with 4 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In4[A, B, C, D any](title string, fn string, k1 string, v1 A, k2 string, v2 B, k3 string, v3 C, k4 string, v4 D) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1, k2, v2, k3, v3, k4, v4})
}

// In5 starts the trace of a call with 5 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In5[A, B, C, D, E any](title string, fn string, k1 string, v1 A, k2 string, v2 B, k3 string, v3 C, k4 string, v4 D, k5 string, v5 E) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1, k2, v2, k3, v3, k4, v4, k5, v5})
}

// In6 starts the trace of a call with 6 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In6[A, B, C, D, E, F any](title string, fn string, k1 string, v1 A, k2 string, v2 B, k3 string, v3 C, k4 string, v4 D, k5 string, v5 E, k6 string, v6 F) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6})
}

// In7 starts the trace of a call with 7 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In7[A, B, C, D, E, F, G any](title string, fn string, k1 string, v1 A, k2 string, v2 B, k3 string, v3 C, k4 string, v4 D, k5 string, v5 E, k6 string, v6 F, k7 string, v7 G) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6, k7, v7})
}

// In8 starts the trace of a call with 8 argument(s), given as name and
// value pairs. It returns nil, and does nothing, while debug is off.
func In8[A, B, C, D, E, F, G, H any](title string, fn string, k1 string, v1 A, k2 string, v2 B, k3 string, v3 C, k4 string, v4 D, k5 string, v5 E, k6 string, v6 F, k7 string, v7 G, k8 string, v8 H) *Span {
	if !debugEnabled.Load() {
		return nil
	}
	return enter(title, fn, []any{k1, v1, k2, v2, k3, v3, k4, v4, k5, v5, k6, v6, k7, v7, k8, v8})
}

// Out0 ends the trace of a call with 0 result(s), passed by address so
// the values are read when the function returns. Defer it directly:
//
//	defer logger.Out0(logger.In1("Title", "Func", "name", name))
//
// A panic passing through is logged with its location and stack, then
// raised again unchanged.
func Out0(s *Span) {
	if s == nil {
		return
	}
	if p := recover(); p != nil {
		s.panicked(p)
		panic(p)
	}
	s.leave([]any{})
}

// Out1 ends the trace of a call with 1 result(s), passed by address so
// the values are read when the function returns. Defer it directly:
//
//	defer logger.Out1(logger.In1("Title", "Func", "name", name), &out0)
//
// A panic passing through is logged with its location and stack, then
// raised again unchanged.
func Out1[A any](s *Span, r1 *A) {
	if s == nil {
		return
	}
	if p := recover(); p != nil {
		s.panicked(p)
		panic(p)
	}
	s.leave([]any{*r1})
}

// Out2 ends the trace of a call with 2 result(s), passed by address so
// the values are read when the function returns. Defer it directly:
//
//	defer logger.Out2(logger.In1("Title", "Func", "name", name), &out0, &out1)
//
// A panic passing through is logged with its location and stack, then
// raised again unchanged.
func Out2[A, B any](s *Span, r1 *A, r2 *B) {
	if s == nil {
		return
	}
	if p := recover(); p != nil {
		s.panicked(p)
		panic(p)
	}
	s.leave([]any{*r1, *r2})
}

// Out3 ends the trace of a call with 3 result(s), passed by address so
// the values are read when the function returns. Defer it directly:
//
//	defer logger.Out3(logger.In1("Title", "Func", "name", name), &out0, &out1, &out2)
//
// A panic passing through is logged with its location and stack, then
// raised again unchanged.
func Out3[A, B, C any](s *Span, r1 *A, r2 *B, r3 *C) {
	if s == nil {
		return
	}
	if p := recover(); p != nil {
		s.panicked(p)
		panic(p)
	}
	s.leave([]any{*r1, *r2, *r3})
}

// Out4 ends the trace of a call with 4 result(s), passed by address so
// the values are read when the function returns. Defer it directly:
//
//	defer logger.Out4(logger.In1("Title", "Func", "name", name), &out0, &out1, &out2, &out3)
//
// A panic passing through is logged with its location and stack, then
// raised again unchanged.
func Out4[A, B, C, D any](s *Span, r1 *A, r2 *B, r3 *C, r4 *D) {
	if s == nil {
		return
	}
	if p := recover(); p != nil {
		s.panicked(p)
		panic(p)
	}
	s.leave([]any{*r1, *r2, *r3, *r4})
}
