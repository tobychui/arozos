package aroz

import (
	"path"
	"strings"
)

/*
	trash.go

	Which deletes go to the trash bin. Only files do: Explorer deletes a
	folder by deleting what is inside it first, so the files arrive in the bin
	one by one under their old folders, where the trash bin can restore them,
	and the emptied folder is removed for good. That is how Samba's recycle
	module works too.

	Office, LibreOffice, macOS and Explorer create and delete helper files all
	the time. Those never reach the bin, or it would fill with them.
*/

// wantsTrash reports whether deleting p should move it to the trash bin.
func (s *share) wantsTrash(p string) bool {
	opt := s.v.opt
	if opt == nil || opt.Trash == nil || opt.UseTrash == nil || !opt.UseTrash() {
		return false
	}
	//A stream is deleted with its file, or on its own for good
	if basePath(p) != p {
		return false
	}
	//Drives that only move whole files cannot rename into the bin
	if s.fsh.RequireBuffer || s.fsh.ReadOnly {
		return false
	}
	for _, segment := range strings.Split(p, "/") {
		if segment == ".trash" || segment == ".metadata" {
			return false
		}
	}
	return !isScratchFile(path.Base(p))
}

// isScratchFile spots the helper files programs delete by themselves.
func isScratchFile(name string) bool {
	lower := strings.ToLower(name)
	switch lower {
	case ".ds_store", "thumbs.db", "desktop.ini", ".localized":
		return true
	}
	for _, prefix := range []string{"~$", ".~lock.", "._", "~wr", ".~"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	for _, suffix := range []string{".tmp", ".temp", ".crdownload", ".partial", ".part", ".swp"} {
		if strings.HasSuffix(lower, suffix) {
			return true
		}
	}
	return false
}
