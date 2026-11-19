#!/bin/sh
#
# Copies the Syncthing packages ArozOS builds into src/third_party/syncthing
# =========================================================================
#
# ArozOS embeds Syncthing (mod/fileservers/servers/syncthingserv). Syncthing's
# lib/api needs a generated file with its web GUI, which the published module
# does not carry, so the packages are kept in the tree with a stub for it and
# src/go.mod points the module at them with a replace line.
#
# Usage, from anywhere in the repository:
#   sh scripts/vendor-syncthing.sh v2.1.7
#
# Then set the require line of github.com/syncthing/syncthing in src/go.mod to
# the pseudo version this prints, update syncthingVersion in
# syncthingserv/engine_syncthing.go, and run `go build` and the tests in src/.
# Only the non-test files of the packages ArozOS uses (on every platform it
# builds for) are copied; the MPL-2.0 licence and the authors list come along.

set -eu

ref=${1:-}
if [ -z "$ref" ]; then
	echo "usage: $0 <syncthing tag or commit>" >&2
	exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
dest="$root/src/third_party/syncthing"

# The module path has no /v2, so Go only takes a v2 release by its commit
commit=$(git ls-remote https://github.com/syncthing/syncthing "refs/tags/$ref^{}" | cut -f1)
[ -n "$commit" ] || commit=$ref

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
cat >go.mod <<'EOF'
module stvendor

go 1.26
EOF
cat >main.go <<'EOF'
package main

import (
	_ "github.com/syncthing/syncthing/lib/build"
	_ "github.com/syncthing/syncthing/lib/config"
	_ "github.com/syncthing/syncthing/lib/events"
	_ "github.com/syncthing/syncthing/lib/fs"
	_ "github.com/syncthing/syncthing/lib/locations"
	_ "github.com/syncthing/syncthing/lib/protocol"
	_ "github.com/syncthing/syncthing/lib/svcutil"
	_ "github.com/syncthing/syncthing/lib/syncthing"
)

func main() {}
EOF
go get "github.com/syncthing/syncthing@$commit" >/dev/null 2>&1
version=$(go list -m -f '{{.Version}}' github.com/syncthing/syncthing)
src=$(go list -m -f '{{.Dir}}' github.com/syncthing/syncthing)

# Every package any build target needs
targets="darwin/amd64 darwin/arm64 freebsd/amd64 freebsd/386 linux/amd64 linux/386 linux/arm linux/arm64 linux/riscv64 linux/loong64 windows/amd64 windows/arm64"
for t in $targets; do
	GOOS=${t%/*} GOARCH=${t#*/} CGO_ENABLED=0 go list -tags noassets -deps . 2>/dev/null
done | grep '^github.com/syncthing/syncthing/' | sort -u >"$work/packages"

rm -rf "$dest"
mkdir -p "$dest"
while IFS= read -r pkg; do
	rel=${pkg#github.com/syncthing/syncthing/}
	mkdir -p "$dest/$rel"
	find "$src/$rel" -maxdepth 1 -type f ! -name '*_test.go' -exec cp {} "$dest/$rel/" \;
	# Folders the package embeds, like the SQL schema of the index
	for dir in $(grep -h '^//go:embed' "$src/$rel"/*.go 2>/dev/null | sed 's#^//go:embed##' | tr ' ' '\n' | cut -d/ -f1 | sort -u); do
		if [ -d "$src/$rel/$dir" ]; then
			cp -R "$src/$rel/$dir" "$dest/$rel/"
		fi
	done
done <"$work/packages"
cp "$src/go.mod" "$src/LICENSE" "$src/AUTHORS" "$dest/"

# The web GUI is never served by ArozOS: the stub Syncthing itself uses for
# builds without it, without the noassets build tag
stub="$dest/lib/api/auto/gui_stub.go"
sed 's#^//go:build noassets$#//go:build !noassets#' "$src/lib/api/auto/noassets.go" >"$stub"

# The module cache is read only
chmod -R u+w "$dest"

# With cgo on, Syncthing's index uses the C sqlite of mattn/go-sqlite3, which
# turns ArozOS into a binary linked by gcc (a broken one with TDM-GCC on
# Windows). The pure Go modernc.org/sqlite is used on every build instead.
rm -f "$dest/internal/db/sqlite/db_open_cgo.go"
sed -i 's#^//go:build !cgo && !wazero$#//go:build !wazero#' "$dest/internal/db/sqlite/db_open_nocgo.go"
grep -q '^//go:build !wazero$' "$dest/internal/db/sqlite/db_open_nocgo.go" || {
	echo "db_open_nocgo.go changed upstream, check the sqlite driver choice" >&2
	exit 1
}

cat >"$dest/README.md" <<EOF
# Syncthing (third party)

The Syncthing packages ArozOS embeds, from
[syncthing/syncthing](https://github.com/syncthing/syncthing) $ref
(commit $commit), licensed under the Mozilla Public License 2.0 (LICENSE).

Copied by \`scripts/vendor-syncthing.sh\`. Do not edit these files: change
the script, or report changes upstream. Two things differ from Syncthing's
own copy: \`lib/api/auto/gui_stub.go\` is \`lib/api/auto/noassets.go\`
without its build tag, because ArozOS never serves the Syncthing web GUI;
and \`internal/db/sqlite\` always uses the pure Go modernc.org/sqlite
(\`db_open_cgo.go\` is left out), so ArozOS never needs cgo.
EOF

echo "Copied $(wc -l <"$work/packages") packages of $ref to $dest"
echo "src/go.mod require line: github.com/syncthing/syncthing $version"
