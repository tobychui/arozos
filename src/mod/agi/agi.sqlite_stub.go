//go:build (linux && mipsle) || (windows && arm) || (windows && 386)

package agi

// SQLiteLibRegister is a no-op on platforms where modernc.org/libc/sqlite
// does not provide a C-runtime port (linux/mipsle, windows/arm, windows/386).
// requirelib("sqlite") will return false in AGI scripts on these platforms.
func (g *Gateway) SQLiteLibRegister() {}
