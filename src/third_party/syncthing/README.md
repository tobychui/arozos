# Syncthing (third party)

The Syncthing packages ArozOS embeds, from
[syncthing/syncthing](https://github.com/syncthing/syncthing) v2.1.7
(commit d6d0181f7d466381c4b39ec8fd944c364f939b32), licensed under the Mozilla Public License 2.0 (LICENSE).

Copied by `scripts/vendor-syncthing.sh`. Do not edit these files: change
the script, or report changes upstream. Two things differ from Syncthing's
own copy: `lib/api/auto/gui_stub.go` is `lib/api/auto/noassets.go`
without its build tag, because ArozOS never serves the Syncthing web GUI;
and `internal/db/sqlite` always uses the pure Go modernc.org/sqlite
(`db_open_cgo.go` is left out), so ArozOS never needs cgo.
