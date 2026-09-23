package main

/*
	Thumbnails of cluster:/ files

	cluster:/ is a buffered drive, so the ordinary renderers cannot open its
	files, and a .metadata/.cache folder inside it would be a real cluster
	file that gets placed and replicated like any other. Instead the drive
	implements arozfs.ThumbnailRenderer through the backend below:

	- the key of a thumbnail is the SHA-256 of the file from its metadata
	  record, so the cache on this host is keyed by content and a changed
	  file never shows an old thumbnail
	- the image is rendered by a node holding a copy, this node first
	  (mod/cluster/storage/thumbnail.go), with metadata.RenderLocalFile on
	  that node's own copy; only the thumbnail crosses the network

	Earlier builds created empty .metadata/.cache folders in the namespace
	while trying to render. clusterRemoveThumbnailFolders removes them.
*/

import (
	"context"
	"errors"
	"path"
	"strconv"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/metadata"
)

const (
	//clusterThumbnailTimeout bounds one thumbnail request, the frame grab of
	//a video on a slow holder included
	clusterThumbnailTimeout = 90 * time.Second
	//thumbnailCacheMaxAge is how long an unused thumbnail is kept on this host
	thumbnailCacheMaxAge = 30 * 24 * time.Hour
)

// ThumbnailKey identifies the content of a namespace file. It completes the
// clusterfs.ThumbnailBackend interface.
func (b *clusterBackend) ThumbnailKey(logical string) (string, error) {
	if clusterMetadata == nil {
		return "", errors.New("this node is not in a cluster")
	}
	rec, err := clusterMetadata.Stat(logical)
	if err != nil {
		return "", err
	}
	if rec.IsDir {
		return "", arozfs.ErrNoThumbnail
	}
	return clusterThumbnailKey(rec.Checksum, rec.ID, rec.Size, rec.ModTime), nil
}

// clusterThumbnailKey is the checksum of the file when it has one. A record
// still being written has none yet, and is keyed by its identity instead.
func clusterThumbnailKey(checksum string, fileID string, size int64, modTime int64) string {
	if checksum != "" {
		return "cluster-sha256:" + checksum
	}
	return "cluster-file:" + fileID + ":" + strconv.FormatInt(size, 10) + ":" + strconv.FormatInt(modTime, 10)
}

// RenderThumbnail has a node holding a copy render the thumbnail. It
// completes the clusterfs.ThumbnailBackend interface.
func (b *clusterBackend) RenderThumbnail(logical string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), clusterThumbnailTimeout)
	defer cancel()
	return b.s.Thumbnail(ctx, logical, metadata.ThumbnailFeature(logical))
}

// clusterRenderThumbnail renders a copy on one of this node's volumes, for
// this node or for another member asking it.
func clusterRenderThumbnail(osPath string) ([]byte, error) {
	return metadata.RenderLocalFile(osPath)
}

// clusterRemoveThumbnailFolders removes the empty .metadata/.cache folders an
// earlier build left in the namespace, and the .metadata folder around one
// when nothing else (a trash folder, say) is in it. Only the master node does
// it, so the members do not race each other over the same records.
func clusterRemoveThumbnailFolders() int {
	if clusterStorage == nil || clusterMetadata == nil || !clusterManager.InCluster() || !clusterMetadata.IsLeader() {
		return 0
	}
	removed := 0
	for _, rec := range clusterMetadata.ListSubtree("/") {
		if !clusterIsThumbnailFolder(rec.Path, rec.IsDir) {
			continue
		}
		if len(clusterMetadata.ListSubtree(rec.Path)) > 0 {
			//Something was put in there; leave it alone
			continue
		}
		if clusterStorage.Remove(rec.Path, false) != nil {
			continue
		}
		removed++
		parent := path.Dir(rec.Path)
		if children, err := clusterMetadata.ListDir(parent); err == nil && len(children) == 0 {
			clusterStorage.Remove(parent, false)
		}
	}
	if removed > 0 {
		systemWideLogger.PrintAndLog("Cluster", "Removed "+strconv.Itoa(removed)+" unused thumbnail folder(s) from cluster:/", nil)
	}
	return removed
}

// clusterIsThumbnailFolder reports whether a namespace path is a
// .metadata/.cache folder.
func clusterIsThumbnailFolder(p string, isDir bool) bool {
	return isDir && path.Base(p) == ".cache" && path.Base(path.Dir(p)) == ".metadata"
}
