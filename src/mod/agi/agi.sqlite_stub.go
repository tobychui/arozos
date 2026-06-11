//go:build (linux && mipsle) || (windows && arm)

package agi

// SQLiteLibRegister is a no-op on platforms where modernc.org/libc/sqlite
// does not provide a C-runtime port (e.g. linux/mipsle, windows/arm).
// requirelib("sqlite") will return false in AGI scripts on these platforms.
func (g *Gateway) SQLiteLibRegister() {}
