package git

/*
	blob.go

	Reading a file's content at a given revision.

	This backs the rich preview in GitApp: an image or PDF that changed is shown
	as a before/after pair, and the "before" side only exists inside the object
	database, so it has to be extracted rather than read off disk.
*/

import (
	"errors"
	"regexp"
	"strings"

	"github.com/go-git/go-git/v5/plumbing"
)

// maxBlobBytes caps what may be pulled into memory for a preview. Anything
// larger is refused so a stray multi-gigabyte asset cannot exhaust the server.
const maxBlobBytes = 8 * 1024 * 1024

// headRevision is the revision name meaning "the current HEAD commit".
const headRevision = "HEAD"

// commitHashPattern matches a full 40 character SHA-1, the only hash form
// accepted from callers.
var commitHashPattern = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)

/*
FileBlob returns the content of a repository-relative path at a revision.

revision is either "HEAD" (or empty, meaning the same) or a full commit hash.
The second return value reports whether the path existed in that revision at
all, which lets the caller distinguish "added in this change" from a genuine
read failure.
*/
func (m *Manager) FileBlob(realpath string, file string, revision string) ([]byte, bool, error) {
	cleaned, err := cleanRepoPath(file)
	if err != nil {
		return nil, false, err
	}

	repo, err := m.open(realpath)
	if err != nil {
		return nil, false, err
	}

	revision = strings.TrimSpace(revision)

	var hash plumbing.Hash
	if revision == "" || strings.EqualFold(revision, headRevision) {
		head, herr := repo.Head()
		if herr != nil {
			if errors.Is(herr, plumbing.ErrReferenceNotFound) {
				//Unborn branch: nothing has been committed yet
				return nil, false, nil
			}
			return nil, false, herr
		}
		hash = head.Hash()
	} else {
		if !commitHashPattern.MatchString(revision) {
			return nil, false, errors.New("not a commit hash: " + revision)
		}
		hash = plumbing.NewHash(revision)
	}

	commit, err := repo.CommitObject(hash)
	if err != nil {
		return nil, false, err
	}

	treeFile, err := commit.File(cleaned)
	if err != nil {
		//Absent from this revision, which is a normal answer rather than a fault
		return nil, false, nil
	}
	if treeFile.Size > maxBlobBytes {
		return nil, true, errors.New("file is too large to load")
	}

	content, err := treeFile.Contents()
	if err != nil {
		return nil, true, err
	}
	return []byte(content), true, nil
}

/*
PreviewMimeType maps a file name onto the media type a browser needs to render
it, or "" when the type is not something a browser displays.

The table is explicit rather than delegating to mime.TypeByExtension: that
consults the Windows registry and /etc/mime.types, so the same repository could
otherwise preview differently on two machines.
*/
func PreviewMimeType(path string) string {
	extension := strings.ToLower(path)
	if index := strings.LastIndex(extension, "."); index >= 0 {
		extension = extension[index:]
	} else {
		return ""
	}

	switch extension {
	//Images
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".ico":
		return "image/x-icon"
	case ".svg":
		return "image/svg+xml"
	case ".avif":
		return "image/avif"

	//Documents
	case ".pdf":
		return "application/pdf"

	//Video
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".ogv":
		return "video/ogg"

	//Audio
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg", ".oga":
		return "audio/ogg"
	case ".flac":
		return "audio/flac"
	case ".m4a":
		return "audio/mp4"

	default:
		return ""
	}
}

// PreviewKind groups a media type into the element the front-end should use.
// Returns "image", "pdf", "video", "audio" or "" when there is no preview.
func PreviewKind(path string) string {
	mimeType := PreviewMimeType(path)
	switch {
	case mimeType == "":
		return ""
	case mimeType == "application/pdf":
		return "pdf"
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	default:
		return ""
	}
}
