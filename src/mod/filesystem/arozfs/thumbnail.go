package arozfs

import "errors"

/*
	Thumbnails of files that are not on this host

	The thumbnail renderer (mod/filesystem/metadata) works on files it can
	open, and keeps each thumbnail in a .metadata/.cache folder next to the
	file. Neither works on a drive whose files live somewhere else: reading
	a whole video over the network to take one frame is wasteful, and
	writing the cache back into the drive turns a throwaway image into a
	file that drive has to store (and, on cluster:/, replicate).

	A file system abstraction that can have a thumbnail made where the file
	is stored implements ThumbnailRenderer. The renderer then asks it for
	the image, and keeps the result in a cache on this host, keyed by what
	ThumbnailKey reports rather than by path, so the cache never lives in
	the drive itself. Abstractions that cannot are left out and keep the
	usual behaviour.
*/

// ErrNoThumbnail is returned by RenderThumbnail when the file has no
// thumbnail to give (an unsupported format, or audio without cover art). It
// is a property of the content, so asking again will not change the answer.
var ErrNoThumbnail = errors.New("no thumbnail for this file")

// ThumbnailRenderer is implemented by file system abstractions that can have
// a thumbnail rendered by whatever holds the file.
type ThumbnailRenderer interface {
	// ThumbnailKey identifies the content of a file. Two calls return the
	// same key only while the content is the same, so a cached thumbnail
	// found under the key is still current.
	ThumbnailKey(realpath string) (string, error)

	// RenderThumbnail returns the encoded (JPEG or PNG) thumbnail of a file.
	RenderThumbnail(realpath string) ([]byte, error)
}
