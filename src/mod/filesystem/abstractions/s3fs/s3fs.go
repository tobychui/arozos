package s3fs

import (
	"bytes"
	"context"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	s3fs.go

	S3-Compatible Object Storage as File System Abstraction.

	Supports AWS S3, MinIO, Wasabi, Backblaze B2, Cloudflare R2, and any other
	S3-compatible storage provider.

	Large-file design: GetObject / PutObject are fully streamed — data flows
	directly between the caller and S3 without ever being fully buffered in
	memory.  PutObject with size=-1 triggers automatic multipart upload inside
	the MinIO SDK, making it safe to write arbitrarily large files on a device
	with very little RAM.

	RequireBuffer = true  (no file-handle semantics; Open/Create return ErrOperationNotSupported)

	Path format in the storage config:
	  Path     = "[http://]<endpoint>[:<port>]/<bucket>[/<prefix>]"
	  Username = Access Key ID
	  Password = Secret Access Key

	Examples:
	  AWS S3  : "s3.amazonaws.com/my-bucket"
	  MinIO   : "http://192.168.1.100:9000/my-bucket/optional-prefix"
	  Wasabi  : "s3.wasabisys.com/my-bucket"
	  R2      : "<account>.r2.cloudflarestorage.com/my-bucket"
*/

// S3FSAbstraction implements filesystem.FileSystemAbstraction backed by S3.
type S3FSAbstraction struct {
	uuid      string
	hierarchy string
	endpoint  string
	bucket    string
	prefix    string // optional root prefix inside the bucket (no leading/trailing slash)
	accessKey string
	secretKey string
	useSSL    bool
	client    *minio.Client
}

// NewS3FSAbstraction creates and validates a new S3 filesystem abstraction.
// The endpoint should NOT include a scheme (http/https); pass useSSL = false
// for plain HTTP endpoints (e.g. local MinIO in development).
func NewS3FSAbstraction(uuid, hierarchy, endpoint, bucket, prefix, accessKey, secretKey string, useSSL bool) (*S3FSAbstraction, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}

	// Validate the bucket is reachable within a short timeout.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, os.ErrNotExist // bucket not found
	}

	prefix = strings.Trim(prefix, "/")
	log.Printf("[S3 FS] Mounted s3://%s/%s (endpoint=%s ssl=%v)\n", bucket, prefix, endpoint, useSSL)

	return &S3FSAbstraction{
		uuid:      uuid,
		hierarchy: hierarchy,
		endpoint:  endpoint,
		bucket:    bucket,
		prefix:    prefix,
		accessKey: accessKey,
		secretKey: secretKey,
		useSSL:    useSSL,
		client:    client,
	}, nil
}

// ---------------------------------------------------------------------------
// Internal path helpers
// ---------------------------------------------------------------------------

// realPathToKey converts a filesystem real-path (e.g. "/videos/movie.mp4")
// to an S3 object key (e.g. "myprefix/videos/movie.mp4").
func (s *S3FSAbstraction) realPathToKey(realPath string) string {
	realPath = strings.TrimPrefix(filterFilepath(realPath), "/")
	if realPath == "" || realPath == "." {
		return s.prefix // bucket root (or configured prefix root)
	}
	if s.prefix != "" {
		return s.prefix + "/" + realPath
	}
	return realPath
}

// keyToRealPath is the inverse of realPathToKey.
func (s *S3FSAbstraction) keyToRealPath(key string) string {
	key = strings.TrimSuffix(key, "/") // strip directory-marker trailing slash
	if s.prefix != "" {
		key = strings.TrimPrefix(key, s.prefix+"/")
	}
	if key == "" {
		return "/"
	}
	return "/" + key
}

// ---------------------------------------------------------------------------
// Fundamental Functions (required by FileSystemAbstraction)
// ---------------------------------------------------------------------------

func (s *S3FSAbstraction) Chmod(_ string, _ os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}

func (s *S3FSAbstraction) Chown(_ string, _, _ int) error {
	return arozfs.ErrOperationNotSupported
}

func (s *S3FSAbstraction) Chtimes(_ string, _, _ time.Time) error {
	return arozfs.ErrOperationNotSupported
}

// Create is not supported; use WriteStream instead.
func (s *S3FSAbstraction) Create(_ string) (arozfs.File, error) {
	return nil, arozfs.ErrOperationNotSupported
}

// Mkdir creates an S3 "directory" marker (a zero-byte object whose key ends
// with "/").  Many S3 clients create these markers so directory listings work
// correctly even in empty directories.
func (s *S3FSAbstraction) Mkdir(filename string, _ os.FileMode) error {
	key := s.realPathToKey(filename)
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}
	ctx := context.Background()
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader([]byte{}), 0,
		minio.PutObjectOptions{ContentType: "application/x-directory"})
	return err
}

func (s *S3FSAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	return s.Mkdir(filename, mode)
}

func (s *S3FSAbstraction) Name() string { return s.bucket }

// Open is not supported; use ReadStream instead.
func (s *S3FSAbstraction) Open(_ string) (arozfs.File, error) {
	return nil, arozfs.ErrOperationNotSupported
}

// OpenFile is not supported; use ReadStream / WriteStream instead.
func (s *S3FSAbstraction) OpenFile(_ string, _ int, _ os.FileMode) (arozfs.File, error) {
	return nil, arozfs.ErrOperationNotSupported
}

// Remove deletes a file or directory (recursively) from S3.
func (s *S3FSAbstraction) Remove(filename string) error {
	if s.IsDir(filename) {
		return s.RemoveAll(filename)
	}
	key := s.realPathToKey(filename)
	ctx := context.Background()
	return s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

// RemoveAll deletes every object whose key starts with the given prefix.
func (s *S3FSAbstraction) RemoveAll(path string) error {
	prefix := s.realPathToKey(path)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	ctx := context.Background()
	objectsCh := s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	for obj := range objectsCh {
		if obj.Err != nil {
			return obj.Err
		}
		if err := s.client.RemoveObject(ctx, s.bucket, obj.Key, minio.RemoveObjectOptions{}); err != nil {
			return err
		}
	}

	// Also remove the directory marker itself if it exists.
	_ = s.client.RemoveObject(ctx, s.bucket, prefix, minio.RemoveObjectOptions{})
	return nil
}

// Rename copies all objects from oldname to newname then removes the originals.
// S3 has no native rename; this is a copy-then-delete sequence.
func (s *S3FSAbstraction) Rename(oldname, newname string) error {
	ctx := context.Background()

	if s.IsDir(oldname) {
		oldPrefix := s.realPathToKey(oldname)
		newPrefix := s.realPathToKey(newname)
		if !strings.HasSuffix(oldPrefix, "/") {
			oldPrefix += "/"
		}
		if !strings.HasSuffix(newPrefix, "/") {
			newPrefix += "/"
		}

		objectsCh := s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
			Prefix:    oldPrefix,
			Recursive: true,
		})
		for obj := range objectsCh {
			if obj.Err != nil {
				return obj.Err
			}
			newKey := newPrefix + strings.TrimPrefix(obj.Key, oldPrefix)
			_, err := s.client.CopyObject(ctx,
				minio.CopyDestOptions{Bucket: s.bucket, Object: newKey},
				minio.CopySrcOptions{Bucket: s.bucket, Object: obj.Key},
			)
			if err != nil {
				return err
			}
			_ = s.client.RemoveObject(ctx, s.bucket, obj.Key, minio.RemoveObjectOptions{})
		}
		return nil
	}

	oldKey := s.realPathToKey(oldname)
	newKey := s.realPathToKey(newname)
	_, err := s.client.CopyObject(ctx,
		minio.CopyDestOptions{Bucket: s.bucket, Object: newKey},
		minio.CopySrcOptions{Bucket: s.bucket, Object: oldKey},
	)
	if err != nil {
		return err
	}
	return s.client.RemoveObject(ctx, s.bucket, oldKey, minio.RemoveObjectOptions{})
}

// Stat returns file metadata.  Directories are synthesised if any object
// exists under that prefix.
func (s *S3FSAbstraction) Stat(filename string) (os.FileInfo, error) {
	if s.IsDir(filename) {
		return NewS3FileInfo(arozfs.Base(filename), 0, true, time.Now()), nil
	}
	key := s.realPathToKey(filename)
	ctx := context.Background()
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return nil, err
	}
	return NewS3FileInfo(arozfs.Base(info.Key), info.Size, false, info.LastModified), nil
}

func (s *S3FSAbstraction) Close() error { return nil }

// ---------------------------------------------------------------------------
// Utility Functions (required by FileSystemAbstraction)
// ---------------------------------------------------------------------------

func (s *S3FSAbstraction) VirtualPathToRealPath(subpath, username string) (string, error) {
	return arozfs.GenericVirtualPathToRealPathTranslator(s.uuid, s.hierarchy, subpath, username)
}

func (s *S3FSAbstraction) RealPathToVirtualPath(fullpath, username string) (string, error) {
	return arozfs.GenericRealPathToVirtualPathTranslator(s.uuid, s.hierarchy, fullpath, username)
}

// FileExists returns true if an object with this key exists, or if any object
// exists under this key as a prefix (i.e. it is a non-empty "directory").
func (s *S3FSAbstraction) FileExists(realpath string) bool {
	key := s.realPathToKey(realpath)
	ctx := context.Background()

	// Try exact object match first.
	_, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err == nil {
		return true
	}
	// Fall back to directory check.
	return s.IsDir(realpath)
}

// IsDir returns true when the given path corresponds to a virtual S3
// "directory" — i.e. at least one object exists with that key as a prefix.
func (s *S3FSAbstraction) IsDir(realpath string) bool {
	key := s.realPathToKey(realpath)

	// Bucket / prefix root is always a directory.
	if key == "" || key == s.prefix {
		return true
	}

	prefix := key
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	ctx := context.Background()

	// Check for explicit directory marker.
	_, err := s.client.StatObject(ctx, s.bucket, prefix, minio.StatObjectOptions{})
	if err == nil {
		return true
	}

	// Check if any objects live under this prefix.
	objCh := s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: false,
	})
	for obj := range objCh {
		if obj.Err == nil {
			return true
		}
	}
	return false
}

func (s *S3FSAbstraction) Glob(_ string) ([]string, error) {
	return []string{}, arozfs.ErrOperationNotSupported
}

func (s *S3FSAbstraction) GetFileSize(realpath string) int64 {
	key := s.realPathToKey(realpath)
	ctx := context.Background()
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return 0
	}
	return info.Size
}

func (s *S3FSAbstraction) GetModTime(realpath string) (int64, error) {
	key := s.realPathToKey(realpath)
	ctx := context.Background()
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return 0, err
	}
	return info.LastModified.Unix(), nil
}

func (s *S3FSAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	return s.WriteStream(filename, bytes.NewReader(content), mode)
}

func (s *S3FSAbstraction) ReadFile(filename string) ([]byte, error) {
	rc, err := s.ReadStream(filename)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

// ReadDir lists the immediate children of a virtual S3 directory.
// Uses non-recursive listing with "/" as the delimiter so that only the
// direct contents of the requested level are returned.
func (s *S3FSAbstraction) ReadDir(dirname string) ([]fs.DirEntry, error) {
	results := []fs.DirEntry{}

	prefix := s.realPathToKey(dirname)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	ctx := context.Background()
	objectsCh := s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: false, // use "/" delimiter implicitly → virtual dirs appear as entries
	})

	for obj := range objectsCh {
		if obj.Err != nil {
			return results, obj.Err
		}

		// Skip the directory marker for the current directory itself.
		if obj.Key == prefix {
			continue
		}

		// Extract the name relative to this directory.
		name := strings.TrimPrefix(obj.Key, prefix)
		name = strings.TrimSuffix(name, "/")
		if name == "" {
			continue
		}

		// In non-recursive mode, virtual sub-directories come back as keys
		// ending with "/" (common prefixes).
		isDir := strings.HasSuffix(obj.Key, "/")
		results = append(results, NewS3DirEntry(name, obj.Size, isDir, obj.LastModified))
	}

	return results, nil
}

// WriteStream uploads data from stream directly to S3.
//
// Passing size = -1 (unknown) triggers the MinIO SDK's automatic multipart
// upload, which splits the stream into parts in memory (default 16 MiB each)
// and uploads them concurrently — the full file is NEVER held in RAM, making
// this safe on devices with very limited memory.
func (s *S3FSAbstraction) WriteStream(filename string, stream io.Reader, _ os.FileMode) error {
	key := s.realPathToKey(filename)
	ctx := context.Background()
	_, err := s.client.PutObject(ctx, s.bucket, key, stream, -1,
		minio.PutObjectOptions{
			ContentType: "application/octet-stream",
			// PartSize 0 means the SDK chooses the optimal part size automatically.
		})
	return err
}

// ReadStream opens an S3 object and returns its body as an io.ReadCloser.
//
// The caller receives a streaming reader backed by the S3 HTTP response body;
// no data is loaded into memory until the caller calls Read().  This allows
// seeking/serving arbitrarily large files on memory-constrained devices.
func (s *S3FSAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	key := s.realPathToKey(filename)
	ctx := context.Background()
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}

// Walk visits every node (file and directory) reachable from root, calling
// walkFn for each.  It uses directory-level recursive calls on ReadDir rather
// than a single flat S3 list, so directory entries are included naturally.
func (s *S3FSAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	rootInfo := NewS3FileInfo(arozfs.Base(root), 0, true, time.Now())
	if err := walkFn(root, rootInfo, nil); err != nil {
		return err
	}
	return s.walkDir(root, walkFn)
}

func (s *S3FSAbstraction) walkDir(dirPath string, walkFn filepath.WalkFunc) error {
	entries, err := s.ReadDir(dirPath)
	if err != nil {
		_ = walkFn(dirPath, nil, err)
		return err
	}
	for _, entry := range entries {
		fullPath := arozfs.ToSlash(filepath.Join(dirPath, entry.Name()))
		info, _ := entry.Info()
		if err := walkFn(fullPath, info, nil); err != nil {
			return err
		}
		if entry.IsDir() {
			if err := s.walkDir(fullPath, walkFn); err != nil {
				return err
			}
		}
	}
	return nil
}

// Heartbeat checks that the bucket is still reachable.
func (s *S3FSAbstraction) Heartbeat() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := s.client.BucketExists(ctx, s.bucket)
	return err
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// filterFilepath normalises a raw filesystem path.
func filterFilepath(rawpath string) string {
	rawpath = arozfs.ToSlash(filepath.Clean(strings.TrimSpace(rawpath)))
	if strings.HasPrefix(rawpath, "./") {
		return rawpath[1:]
	} else if rawpath == "." || rawpath == "" {
		return "/"
	}
	return rawpath
}
