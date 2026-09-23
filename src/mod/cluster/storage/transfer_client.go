package storage

/*
	Chunked transfer protocol - client side. Every request is one signed ACN
	call of at most MaxChunkSize bytes, so a transfer survives proxies that
	cap request size or duration.
*/

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/cluster/acn"
)

// Client moves files to and from other nodes' volumes.
type Client struct {
	Transport *acn.Transport
}

const chunkRetries = 3

func (c *Client) postJSON(ctx context.Context, nodeID string, path string, in interface{}, out interface{}) error {
	return c.Transport.DoJSON(ctx, nodeID, http.MethodPost, path, in, out)
}

// Upload sends size bytes from r to the volume on nodeID, resuming a
// previous attempt of the same file when the target still has chunks.
func (c *Client) Upload(ctx context.Context, nodeID string, volumeID string, logical string, fileID string, r io.Reader, size int64, checksum string, progress func(done int64)) error {
	var begin BeginResponse
	if err := c.postJSON(ctx, nodeID, pathBegin, BeginRequest{VolumeID: volumeID, Path: logical, Size: size, Checksum: checksum, FileID: fileID}, &begin); err != nil {
		return err
	}
	have := map[int]bool{}
	for _, i := range begin.Have {
		have[i] = true
	}
	buf := make([]byte, ChunkSize)
	var done int64
	for index := 0; int64(index)*ChunkSize < size; index++ {
		want := ChunkSize
		if remaining := size - int64(index)*ChunkSize; remaining < int64(want) {
			want = int(remaining)
		}
		n, err := io.ReadFull(r, buf[:want])
		if err != nil {
			return err
		}
		done += int64(n)
		if have[index] {
			if progress != nil {
				progress(done)
			}
			continue
		}
		chunk := buf[:n]
		sum := sha256.Sum256(chunk)
		q := url.Values{"session": {begin.SessionID}, "index": {strconv.Itoa(index)}}
		var lastErr error
		for attempt := 0; attempt < chunkRetries; attempt++ {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			resp, err := c.doRaw(ctx, nodeID, pathChunk+"?"+q.Encode(), chunk, http.Header{HeaderChunkSha: {hex.EncodeToString(sum[:])}, "Content-Type": {"application/octet-stream"}})
			if err == nil && resp.Status == http.StatusOK {
				lastErr = nil
				break
			}
			if err != nil {
				lastErr = err
			} else {
				lastErr = resp.Error()
				if resp.Status == http.StatusNotFound || resp.Status == http.StatusBadRequest {
					break //not retryable
				}
			}
		}
		if lastErr != nil {
			return lastErr
		}
		if progress != nil {
			progress(done)
		}
	}
	var commit CommitResponse
	if err := c.postJSON(ctx, nodeID, pathCommit, SessionRequest{SessionID: begin.SessionID}, &commit); err != nil {
		return err
	}
	if !strings.EqualFold(commit.Checksum, checksum) {
		return ErrChecksum
	}
	return nil
}

// doRaw sends a raw body with extra headers through the transport. The ACN
// signature covers the body; extra headers ride along unsigned (the chunk
// hash is re-verified against the signed body on the receiver).
func (c *Client) doRaw(ctx context.Context, nodeID string, path string, body []byte, extra http.Header) (*acn.Response, error) {
	return c.Transport.DoWithHeaders(ctx, nodeID, http.MethodPost, path, body, extra)
}

// Download streams the file on the given volume into w, verifying every
// chunk and the whole-file checksum when expectChecksum is set.
func (c *Client) Download(ctx context.Context, nodeID string, volumeID string, logical string, w io.Writer, expectChecksum string, progress func(done int64)) error {
	h := sha256.New()
	var offset int64
	var total int64 = -1
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		q := url.Values{
			"volume": {volumeID},
			"path":   {logical},
			"offset": {strconv.FormatInt(offset, 10)},
			"length": {strconv.Itoa(ChunkSize)},
		}
		resp, err := c.Transport.Do(ctx, nodeID, http.MethodGet, pathRead+"?"+q.Encode(), nil)
		if err != nil {
			return err
		}
		if err := resp.Error(); err != nil {
			return err
		}
		if total < 0 {
			total, _ = strconv.ParseInt(resp.Header.Get(HeaderFileSize), 10, 64)
			if total == 0 {
				break
			}
		}
		sum := sha256.Sum256(resp.Body)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), resp.Header.Get(HeaderChunkSha)) {
			return ErrChecksum
		}
		if _, err := w.Write(resp.Body); err != nil {
			return err
		}
		h.Write(resp.Body)
		offset += int64(len(resp.Body))
		if progress != nil {
			progress(offset)
		}
		if len(resp.Body) == 0 || offset >= total {
			break
		}
	}
	if expectChecksum != "" && !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), expectChecksum) {
		return ErrChecksum
	}
	return nil
}

// Stat asks a node about a path on one of its volumes.
func (c *Client) Stat(ctx context.Context, nodeID string, volumeID string, logical string) (*StatResponse, error) {
	q := url.Values{"volume": {volumeID}, "path": {logical}}
	resp, err := c.Transport.Do(ctx, nodeID, http.MethodGet, pathStatFile+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	if err := resp.Error(); err != nil {
		return nil, err
	}
	var st StatResponse
	if err := json.Unmarshal(resp.Body, &st); err != nil {
		return nil, err
	}
	return &st, nil
}

// Mkdir creates a directory on a remote volume.
func (c *Client) Mkdir(ctx context.Context, nodeID string, volumeID string, logical string) error {
	return c.postJSON(ctx, nodeID, pathMkdir, PathRequest{VolumeID: volumeID, Path: logical}, nil)
}

// Delete removes a path on a remote volume.
func (c *Client) Delete(ctx context.Context, nodeID string, volumeID string, logical string, recursive bool) error {
	return c.postJSON(ctx, nodeID, pathDelete, PathRequest{VolumeID: volumeID, Path: logical, Recursive: recursive}, nil)
}

// Rename moves a path within a remote volume.
func (c *Client) Rename(ctx context.Context, nodeID string, volumeID string, from string, to string) error {
	return c.postJSON(ctx, nodeID, pathRename, PathRequest{VolumeID: volumeID, Path: from, NewPath: to}, nil)
}

// List reads a directory on a remote volume.
func (c *Client) List(ctx context.Context, nodeID string, volumeID string, logical string) ([]ListEntry, error) {
	q := url.Values{"volume": {volumeID}, "path": {logical}}
	resp, err := c.Transport.Do(ctx, nodeID, http.MethodGet, pathList+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	if err := resp.Error(); err != nil {
		return nil, err
	}
	var out []ListEntry
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Checksum asks a node to hash a file on one of its volumes.
func (c *Client) Checksum(ctx context.Context, nodeID string, volumeID string, logical string) (*ChecksumResponse, error) {
	var out ChecksumResponse
	if err := c.postJSON(ctx, nodeID, pathChecksum, PathRequest{VolumeID: volumeID, Path: logical}, &out); err != nil {
		return nil, err
	}
	if out.Checksum == "" {
		return nil, errors.New("empty checksum")
	}
	return &out, nil
}
