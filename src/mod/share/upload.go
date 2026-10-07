package share

/*
	Share upload

	Recipients of a folder share with the "edit" access level can upload files
	into the shared folder:

		POST /share/upload/{uuid}/{optional/sub/folder}
		multipart/form-data, one or more "file" fields

	Files are written as the share owner, count against the owner's storage
	quota and never overwrite an existing file (a "name (1).ext" copy is made).
*/

import (
	"errors"
	"io"
	"net/http"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// handleShareUpload handles POST /share/upload/{uuid}/{subfolder...}
func (s *Manager) handleShareUpload(w http.ResponseWriter, r *http.Request, id string, subfolder string) {
	so := s.lookupActiveShare(id)
	if so == nil {
		http.NotFound(w, r)
		return
	}

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		utils.SendErrorResponse(w, "Method not allowed")
		return
	}

	if !s.authorizeShareAccess(w, r, so, true) {
		return
	}

	if !so.CanUpload() {
		w.WriteHeader(http.StatusForbidden)
		utils.SendErrorResponse(w, "Upload is not allowed on this share")
		return
	}

	if subfolder != "" && !so.ShowFileList {
		w.WriteHeader(http.StatusForbidden)
		utils.SendErrorResponse(w, "The content of this folder is not shared")
		return
	}

	owner, err := s.shareOwnerOf(so)
	if err != nil {
		w.WriteHeader(http.StatusForbidden)
		utils.SendErrorResponse(w, "Share account not exists")
		return
	}

	accessMode := owner.GetPathAccessPermission(so.FileVirtualPath)
	if accessMode != arozfs.FsReadWrite {
		w.WriteHeader(http.StatusForbidden)
		utils.SendErrorResponse(w, "The shared folder is read only")
		return
	}

	targetFsh, err := owner.GetFileSystemHandlerFromVirtualPath(so.FileVirtualPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		utils.SendErrorResponse(w, "Unable to load shared folder")
		return
	}
	fshAbs := targetFsh.FileSystemAbstraction
	rootRpath, err := fshAbs.VirtualPathToRealPath(so.FileVirtualPath, owner.Username)
	if err != nil || !fshAbs.IsDir(rootRpath) {
		http.NotFound(w, r)
		return
	}

	targetDir := rootRpath
	if subfolder != "" {
		targetDir, err = arozfs.ResolvePathWithinRoot(rootRpath, subfolder)
		if err != nil || !fshAbs.IsDir(targetDir) {
			w.WriteHeader(http.StatusBadRequest)
			utils.SendErrorResponse(w, "Invalid upload folder")
			return
		}
	}

	//Content-Length is the whole multipart body, a slight over estimate of the
	//file sizes. Good enough to refuse an upload that cannot fit.
	if r.ContentLength > 0 && !owner.StorageQuota.HaveSpace(r.ContentLength) {
		w.WriteHeader(http.StatusInsufficientStorage)
		utils.SendErrorResponse(w, "Storage quota of the share owner exceeded")
		return
	}

	reader, err := r.MultipartReader()
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		utils.SendErrorResponse(w, "Invalid upload request")
		return
	}

	uploaded := []string{}
	for {
		part, err := reader.NextPart()
		if err != nil {
			//io.EOF: all parts read. Anything else is a broken request.
			if !errors.Is(err, io.EOF) {
				logger.PrintAndLog("Share", "Share upload interrupted", err)
			}
			break
		}

		if part.FormName() != "file" || part.FileName() == "" {
			part.Close()
			continue
		}

		filename, err := sanitizeUploadFilename(part.FileName())
		if err != nil {
			part.Close()
			w.WriteHeader(http.StatusBadRequest)
			utils.SendErrorResponse(w, err.Error())
			return
		}

		destination := uniqueDestination(fshAbs.FileExists, targetDir, filename)
		err = fshAbs.WriteStream(destination, part, 0775)
		part.Close()
		if err != nil {
			logger.PrintAndLog("Share", "Unable to write uploaded file to share "+so.UUID, err)
			w.WriteHeader(http.StatusInternalServerError)
			utils.SendErrorResponse(w, "Unable to write uploaded file")
			return
		}

		//Count the file against the owner's quota
		if vpath, err := fshAbs.RealPathToVirtualPath(destination, owner.Username); err == nil {
			owner.SetOwnerOfFile(targetFsh, vpath)
		}
		uploaded = append(uploaded, arozfs.Base(destination))
	}

	if len(uploaded) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		utils.SendErrorResponse(w, "No file uploaded")
		return
	}

	logger.PrintAndLog("Share", strconv.Itoa(len(uploaded))+" file(s) uploaded to share "+so.UUID+" ("+so.FileVirtualPath+")", nil)
	sendJSON(w, uploaded)
}

// sanitizeUploadFilename keeps only the base name of an uploaded file and
// refuses names that cannot be stored safely.
func sanitizeUploadFilename(name string) (string, error) {
	//Browsers may send a path (e.g. from a folder upload). Keep the last element.
	name = strings.ReplaceAll(name, "\\", "/")
	name = strings.TrimSpace(path.Base(name))
	//Same rule as the File Manager upload: no % in stored filenames
	name = strings.ReplaceAll(name, "%", "_")
	if name == "" || name == "." || name == ".." || name == "/" {
		return "", errors.New("Invalid filename")
	}
	if strings.ContainsAny(name, "\x00:*?\"<>|") {
		return "", errors.New("Filename contains invalid characters: " + name)
	}
	return name, nil
}

// uniqueDestination returns dir/name, or dir/name (n).ext if that is taken
func uniqueDestination(exists func(string) bool, dir string, name string) string {
	candidate := arozfs.ToSlash(filepath.Join(dir, name))
	if !exists(candidate) {
		return candidate
	}

	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate = arozfs.ToSlash(filepath.Join(dir, stem+" ("+strconv.Itoa(i)+")"+ext))
		if !exists(candidate) {
			return candidate
		}
	}
}
