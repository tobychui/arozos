package s3fs

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	s3fs.go

	S3-Compatible Object Storage as File System Abstraction.

	Supports AWS S3, MinIO, Wasabi, Backblaze B2, Cloudflare R2, and any other
	S3-compatible storage provider.

	Uses the official AWS SDK for Go v2 (aws-sdk-go-v2).  Non-AWS endpoints are
	handled via BaseEndpoint + UsePathStyle on the S3 client options, which is the
	standard pattern for S3-compatible services.

	Large-file / low-memory design
	  ReadStream  → s3.GetObject returns resp.Body, an io.ReadCloser that streams
	                directly from S3.  No data is buffered in RAM until the caller
	                calls Read().
	  WriteStream → manager.Uploader wraps PutObject and automatically switches to
	                multipart upload for payloads above the configurable threshold
	                (default 5 MiB per part).  The entire file is never held in
	                memory, making this safe on RAM-constrained devices.

	RequireBuffer = true  (no file-handle semantics; Open/Create are unsupported)

	Path format in the storage config
	  Path     = "[http://]<endpoint>[:<port>]/<bucket>[/<prefix>]"
	  Username = Access Key ID
	  Password = Secret Access Key

	Examples
	  AWS S3           "s3.amazonaws.com/my-bucket"
	  AWS (us-west-2)  "s3.us-west-2.amazonaws.com/my-bucket"
	  MinIO (HTTP)     "http://192.168.1.100:9000/my-bucket/optional-prefix"
	  Wasabi           "s3.wasabisys.com/my-bucket"
	  Cloudflare R2    "<account-id>.r2.cloudflarestorage.com/my-bucket"

	SSL is on by default.  Prepend "http://" to the endpoint to disable it
	(useful for local MinIO / development setups).
*/

// S3FSAbstraction implements filesystem.FileSystemAbstraction backed by S3.
type S3FSAbstraction struct {
	uuid      string
	hierarchy string
	endpoint  string // bare host[:port], no scheme
	bucket    string
	prefix    string // optional root prefix inside the bucket (no leading/trailing slash)
	accessKey string
	secretKey string
	useSSL    bool
	client    *s3.Client
	uploader  *manager.Uploader
}

// NewS3FSAbstraction creates and validates a new S3 filesystem abstraction.
// The caller should NOT include a scheme in endpoint; pass useSSL to control
// http vs https.
func NewS3FSAbstraction(uuid, hierarchy, endpoint, bucket, prefix, accessKey, secretKey string, useSSL bool) (*S3FSAbstraction, error) {
	scheme := "https"
	if !useSSL {
		scheme = "http"
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		// Use "us-east-1" as the default signing region.  For non-AWS endpoints
		// the region only affects request signing and can be arbitrary.
		awsconfig.WithRegion("us-east-1"),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		),
	)
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		// Point at the custom endpoint (MinIO, Wasabi, R2, …).
		// For standard AWS S3, leaving BaseEndpoint empty uses the default resolver.
		if endpoint != "" {
			o.BaseEndpoint = aws.String(scheme + "://" + endpoint)
		}
		// Path-style addressing is required by MinIO and most S3-compatible
		// services; it has no effect on AWS S3 (which supports both).
		o.UsePathStyle = true
	})

	// Validate the bucket is reachable.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(bucket),
	})
	if err != nil {
		var nf *types.NotFound
		if errors.As(err, &nf) {
			return nil, os.ErrNotExist
		}
		return nil, err
	}

	uploader := manager.NewUploader(client)

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
		uploader:  uploader,
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
		return s.prefix
	}
	if s.prefix != "" {
		return s.prefix + "/" + realPath
	}
	return realPath
}

// keyToRealPath is the inverse of realPathToKey.
func (s *S3FSAbstraction) keyToRealPath(key string) string {
	key = strings.TrimSuffix(key, "/")
	if s.prefix != "" {
		key = strings.TrimPrefix(key, s.prefix+"/")
	}
	if key == "" {
		return "/"
	}
	return "/" + key
}

// ---------------------------------------------------------------------------
// Fundamental Functions (FileSystemAbstraction interface)
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

// Mkdir creates a zero-byte S3 "directory marker" object whose key ends with "/".
func (s *S3FSAbstraction) Mkdir(filename string, _ os.FileMode) error {
	key := s.realPathToKey(filename)
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}
	ctx := context.Background()
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader([]byte{}),
		ContentType: aws.String("application/x-directory"),
	})
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

// Remove deletes a single object or an entire virtual directory (recursively).
func (s *S3FSAbstraction) Remove(filename string) error {
	if s.IsDir(filename) {
		return s.RemoveAll(filename)
	}
	key := s.realPathToKey(filename)
	ctx := context.Background()
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	return err
}

// RemoveAll deletes every object whose key starts with the given path prefix.
func (s *S3FSAbstraction) RemoveAll(path string) error {
	prefix := s.realPathToKey(path)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	ctx := context.Background()

	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket:    aws.String(s.bucket),
		Prefix:    aws.String(prefix),
		Delimiter: aws.String(""),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return err
		}
		for _, obj := range page.Contents {
			_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(s.bucket),
				Key:    obj.Key,
			})
			if err != nil {
				return err
			}
		}
	}

	// Also remove any explicit directory marker at this path.
	_, _ = s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(prefix),
	})
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

		paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
			Bucket: aws.String(s.bucket),
			Prefix: aws.String(oldPrefix),
		})
		for paginator.HasMorePages() {
			page, err := paginator.NextPage(ctx)
			if err != nil {
				return err
			}
			for _, obj := range page.Contents {
				newKey := newPrefix + strings.TrimPrefix(aws.ToString(obj.Key), oldPrefix)
				_, err := s.client.CopyObject(ctx, &s3.CopyObjectInput{
					Bucket:     aws.String(s.bucket),
					CopySource: aws.String(s.bucket + "/" + aws.ToString(obj.Key)),
					Key:        aws.String(newKey),
				})
				if err != nil {
					return err
				}
				_, _ = s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
					Bucket: aws.String(s.bucket),
					Key:    obj.Key,
				})
			}
		}
		return nil
	}

	oldKey := s.realPathToKey(oldname)
	newKey := s.realPathToKey(newname)
	_, err := s.client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(s.bucket),
		CopySource: aws.String(s.bucket + "/" + oldKey),
		Key:        aws.String(newKey),
	})
	if err != nil {
		return err
	}
	_, err = s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(oldKey),
	})
	return err
}

// Stat returns object metadata.  Virtual directories are synthesised when any
// objects exist under the path as a prefix.
func (s *S3FSAbstraction) Stat(filename string) (os.FileInfo, error) {
	if s.IsDir(filename) {
		return NewS3FileInfo(arozfs.Base(filename), 0, true, time.Now()), nil
	}
	key := s.realPathToKey(filename)
	ctx := context.Background()
	resp, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	size := int64(0)
	if resp.ContentLength != nil {
		size = *resp.ContentLength
	}
	modTime := time.Now()
	if resp.LastModified != nil {
		modTime = *resp.LastModified
	}
	return NewS3FileInfo(arozfs.Base(key), size, false, modTime), nil
}

func (s *S3FSAbstraction) Close() error { return nil }

// ---------------------------------------------------------------------------
// Utility Functions (FileSystemAbstraction interface)
// ---------------------------------------------------------------------------

func (s *S3FSAbstraction) VirtualPathToRealPath(subpath, username string) (string, error) {
	return arozfs.GenericVirtualPathToRealPathTranslator(s.uuid, s.hierarchy, subpath, username)
}

func (s *S3FSAbstraction) RealPathToVirtualPath(fullpath, username string) (string, error) {
	return arozfs.GenericRealPathToVirtualPathTranslator(s.uuid, s.hierarchy, fullpath, username)
}

// FileExists returns true if an exact object exists with this key, or if the
// path is a virtual directory (i.e. objects exist under it as a prefix).
func (s *S3FSAbstraction) FileExists(realpath string) bool {
	key := s.realPathToKey(realpath)
	ctx := context.Background()
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err == nil {
		return true
	}
	return s.IsDir(realpath)
}

// IsDir returns true when the path represents a virtual S3 "directory":
// either an explicit directory-marker object exists, or at least one object
// has this path as a key prefix.
func (s *S3FSAbstraction) IsDir(realpath string) bool {
	key := s.realPathToKey(realpath)
	// Bucket root (or configured prefix root) is always a directory.
	if key == "" || key == s.prefix {
		return true
	}

	prefix := key
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	ctx := context.Background()

	// Check for an explicit directory-marker object.
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(prefix),
	})
	if err == nil {
		return true
	}

	// Check if any objects exist under this prefix.
	resp, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:  aws.String(s.bucket),
		Prefix:  aws.String(prefix),
		MaxKeys: aws.Int32(1),
	})
	if err == nil && len(resp.Contents) > 0 {
		return true
	}
	return false
}

func (s *S3FSAbstraction) Glob(_ string) ([]string, error) {
	return []string{}, arozfs.ErrOperationNotSupported
}

func (s *S3FSAbstraction) GetFileSize(realpath string) int64 {
	key := s.realPathToKey(realpath)
	ctx := context.Background()
	resp, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil || resp.ContentLength == nil {
		return 0
	}
	return *resp.ContentLength
}

func (s *S3FSAbstraction) GetModTime(realpath string) (int64, error) {
	key := s.realPathToKey(realpath)
	ctx := context.Background()
	resp, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return 0, err
	}
	if resp.LastModified == nil {
		return time.Now().Unix(), nil
	}
	return resp.LastModified.Unix(), nil
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
// Uses ListObjectsV2 with Delimiter "/" so that only the direct contents of
// the requested level are returned (files and virtual sub-directories).
func (s *S3FSAbstraction) ReadDir(dirname string) ([]fs.DirEntry, error) {
	results := []fs.DirEntry{}

	prefix := s.realPathToKey(dirname)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	ctx := context.Background()
	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket:    aws.String(s.bucket),
		Prefix:    aws.String(prefix),
		Delimiter: aws.String("/"),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return results, err
		}

		// CommonPrefixes are virtual sub-directories.
		for _, cp := range page.CommonPrefixes {
			cpKey := aws.ToString(cp.Prefix)
			if cpKey == prefix {
				continue
			}
			name := strings.TrimSuffix(strings.TrimPrefix(cpKey, prefix), "/")
			if name == "" {
				continue
			}
			results = append(results, NewS3DirEntry(name, 0, true, time.Now()))
		}

		// Contents are individual files at this level.
		for _, obj := range page.Contents {
			objKey := aws.ToString(obj.Key)
			// Skip the directory marker for the current directory itself.
			if objKey == prefix {
				continue
			}
			name := strings.TrimPrefix(objKey, prefix)
			name = strings.TrimSuffix(name, "/")
			if name == "" {
				continue
			}
			size := int64(0)
			if obj.Size != nil {
				size = *obj.Size
			}
			modTime := time.Now()
			if obj.LastModified != nil {
				modTime = *obj.LastModified
			}
			isDir := strings.HasSuffix(objKey, "/")
			results = append(results, NewS3DirEntry(name, size, isDir, modTime))
		}
	}

	return results, nil
}

// WriteStream uploads data from stream directly to S3.
//
// The manager.Uploader automatically uses multipart upload when the content
// exceeds the part threshold (default 5 MiB per part).  The full file is
// NEVER held in RAM, which is safe on memory-constrained devices (e.g. a
// Raspberry Pi) even for multi-GiB files.
func (s *S3FSAbstraction) WriteStream(filename string, stream io.Reader, _ os.FileMode) error {
	key := s.realPathToKey(filename)
	_, err := s.uploader.Upload(context.Background(), &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        stream,
		ContentType: aws.String("application/octet-stream"),
	})
	return err
}

// ReadStream opens an S3 object and returns its body as an io.ReadCloser.
//
// The body is the raw HTTP response from S3; no data is loaded into memory
// until the caller calls Read().  This allows serving or copying arbitrarily
// large files on memory-constrained devices.
func (s *S3FSAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	key := s.realPathToKey(filename)
	resp, err := s.client.GetObject(context.Background(), &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	return resp.Body, nil // io.ReadCloser backed directly by the S3 HTTP response
}

// Walk visits every node reachable from root (files and virtual directories),
// calling walkFn for each.  It builds the tree level by level via ReadDir so
// that virtual directory entries are naturally included.
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

// Heartbeat checks that the bucket is still reachable within 5 seconds.
func (s *S3FSAbstraction) Heartbeat() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(s.bucket),
	})
	return err
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func filterFilepath(rawpath string) string {
	rawpath = arozfs.ToSlash(filepath.Clean(strings.TrimSpace(rawpath)))
	if strings.HasPrefix(rawpath, "./") {
		return rawpath[1:]
	} else if rawpath == "." || rawpath == "" {
		return "/"
	}
	return rawpath
}
