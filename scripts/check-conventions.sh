#!/bin/sh
#
# ArozOS contribution convention checker
# =====================================
#
# Enforces the contribution rules documented in CLAUDE.md against *new* code.
# It is intentionally written in portable POSIX sh with only the standard
# git/grep tooling so it runs the same way on a contributor's machine, inside
# the Claude Code PostToolUse hook and in CI (rule 5: no system dependencies).
#
# Usage:
#   scripts/check-conventions.sh <file> [<file> ...]   Check specific files
#   scripts/check-conventions.sh --diff <base-ref>     Check files changed vs base-ref
#   scripts/check-conventions.sh --hook                Read a Claude Code hook
#                                                      payload (JSON) from stdin
#
# Exit status:
#   0   no ERROR-level violations (WARN findings may still be printed)
#   1   at least one ERROR-level violation was found  (CI / direct invocation)
#   2   findings in --hook mode (surfaces the report back to Claude)
#
# Escape hatch:
#   Append the marker  arozos-lint-ignore  to a source line to skip the
#   line-level checks (raw logger / hardcoded path) for that single line.
#   Use it only with a short justification comment.

set -u

errors=0
warns=0

err() { printf '  [ERROR] %s\n' "$1" >&2; errors=$((errors + 1)); }
warn() { printf '  [WARN]  %s\n' "$1" >&2; warns=$((warns + 1)); }

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# is_platform_file returns success when a Go file is scoped to a single OS/arch
# by its filename suffix (e.g. foo_linux.go, bar_windows_amd64.go). Such files
# are the project's sanctioned home for platform-specific code, so the
# portability checks do not apply to them.
is_platform_file() {
	printf '%s' "$1" | grep -Eq \
		'_(linux|windows|darwin|freebsd|openbsd|netbsd|dragonfly|solaris|illumos|aix|android|js|wasm|plan9)(_[a-z0-9]+)?\.go$'
}

has_build_constraint() {
	[ -f "$1" ] && grep -Eq '^//go:build|^// \+build' "$1"
}

# check_lines applies the per-line rules to a stream of source lines supplied on
# stdin. $1 is the file the lines belong to (used for context + exemptions).
check_lines() {
	file=$1

	# Skip the marker so opted-out lines are not re-flagged.
	scan=$(grep -v 'arozos-lint-ignore' || true)

	# --- Rule 1: managed logger, not the standard log package -------------
	# The logger package itself legitimately wraps "log"; everything else must
	# route through logger.PrintAndLog so output lands in the system log.
	case "$file" in
	*mod/info/logger/*) ;;
	*)
		hits=$(printf '%s\n' "$scan" |
			grep -E 'log\.(Print|Printf|Println|Fatal|Fatalf|Fatalln|Panic|Panicf|Panicln)\(' || true)
		if [ -n "$hits" ]; then
			err "$file: uses the standard \"log\" package. New code must call logger.PrintAndLog(title, message, err) instead (rule 1)."
		fi
		;;
	esac

	# --- Rule 5: portability, no hardcoded OS paths -----------------------
	if ! is_platform_file "$file"; then
		paths=$(printf '%s\n' "$scan" |
			grep -E '"(/usr/|/etc/|/var/|/bin/|/sbin/|/opt/|/root/|/home/)|"[A-Za-z]:\\\\|"[A-Za-z]:/' || true)
		if [ -n "$paths" ]; then
			err "$file: contains a hardcoded OS path literal. Build paths with filepath.Join and os.TempDir/UserHomeDir so ArozOS stays cross-platform (rule 5)."
		fi
	fi

	# --- Rule 4: new HTTP endpoints need a deliberate security decision ---
	endpoints=$(printf '%s\n' "$scan" | grep -E 'http\.HandleFunc\(' || true)
	if [ -n "$endpoints" ]; then
		case "$file" in
		*mod/prouter/*) ;; # the permission router wraps http.HandleFunc by design
		*)
			warn "$file: registers an endpoint with raw http.HandleFunc. Prefer prout.NewModuleRouter(...).HandleFunc for auth/permission, or confirm the endpoint is intentionally public (rule 4)."
			;;
		esac
	fi
}

# check_file applies the file-level rules to a single Go source file path.
check_file() {
	file=$1
	case "$file" in
	*_test.go) return ;; # test files are not themselves subject to these rules
	esac

	# --- Rule 5 (soft): isolate platform calls in build-tagged files -----
	if ! is_platform_file "$file" && ! has_build_constraint "$file"; then
		if grep -Eq 'exec\.Command\(|(^|[^.])syscall\.' "$file" 2>/dev/null; then
			warn "$file: calls exec.Command/syscall in a cross-platform file. Move OS-specific code into a *_linux.go / *_windows.go / *_darwin.go file or guard it with a //go:build tag (rule 5)."
		fi
	fi

	# --- Rule 2: every package ships tests -------------------------------
	case "$file" in
	*mod/*)
		dir=$(dirname "$file")
		if ! ls "$dir"/*_test.go >/dev/null 2>&1; then
			warn "$file: package $dir has no *_test.go file. New functions must ship with tests (rule 2)."
		fi
		;;
	esac
}

# license_reminder fires once when dependency manifests change.
license_reminder() {
	warn "go.mod/go.sum changed: confirm every new dependency is MIT, BSD, Apache-2.0, MPL-2.0 or ISC (GPL-compatible and OK for commercial use). Reject GPL/AGPL/unknown-licensed modules (rule 3)."
}

scan_one() {
	file=$1
	case "$file" in
	go.mod | go.sum | */go.mod | */go.sum)
		license_reminder
		return
		;;
	*.go) ;;
	*) return ;;
	esac

	# Single-file / hook mode scans the whole file content.
	check_lines "$file" <"$file"
	check_file "$file"
}

mode=${1:---help}

case "$mode" in
--hook)
	# Extract tool_input.file_path from the hook JSON payload on stdin without
	# requiring jq (rule 5: no extra system dependencies).
	payload=$(cat)
	file=$(printf '%s' "$payload" |
		sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
	[ -z "$file" ] && exit 0
	scan_one "$file"
	if [ "$errors" -gt 0 ] || [ "$warns" -gt 0 ]; then
		printf '\nArozOS convention check: %d error(s), %d warning(s). See CLAUDE.md.\n' \
			"$errors" "$warns" >&2
		exit 2
	fi
	exit 0
	;;

--diff)
	base=${2:-}
	if [ -z "$base" ]; then
		echo "usage: $0 --diff <base-ref>" >&2
		exit 1
	fi
	cd "$repo_root" || exit 1
	changed=$(git diff --name-only --diff-filter=ACM "$base" -- '*.go' 'go.mod' 'go.sum' '**/go.mod' '**/go.sum')
	[ -z "$changed" ] && {
		echo "No Go/module changes to check." >&2
		exit 0
	}
	# Iterate over a temp file rather than a pipe so the err/warn counters,
	# which live in this shell, survive (a piped while-loop runs in a subshell).
	tmp=$(mktemp)
	added=$(mktemp)
	printf '%s\n' "$changed" >"$tmp"
	while IFS= read -r f; do
		[ -n "$f" ] || continue
		case "$f" in
		go.mod | go.sum | */go.mod | */go.sum)
			license_reminder
			continue
			;;
		*.go) ;;
		*) continue ;;
		esac
		printf 'Checking %s\n' "$f" >&2
		# Diff mode only scans *added* lines for the per-line rules. Feed them
		# via redirection (not a pipe) so check_lines runs in this shell.
		git diff -U0 "$base" -- "$f" | grep -E '^\+' | grep -Ev '^\+\+\+' | sed 's/^+//' >"$added"
		check_lines "$f" <"$added"
		check_file "$f"
	done <"$tmp"
	rm -f "$tmp" "$added"
	;;

--help | -h)
	sed -n '2,40p' "$0"
	exit 0
	;;

*)
	# Treat all arguments as explicit file paths.
	for f in "$@"; do
		scan_one "$f"
	done
	;;
esac

printf '\nArozOS convention check: %d error(s), %d warning(s).\n' "$errors" "$warns" >&2
[ "$errors" -gt 0 ] && exit 1
exit 0
