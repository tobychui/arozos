package storage

/*
	Thumbnails rendered where the file is

	A thumbnail of a cluster:/ file is rendered by a node that holds a copy
	of it, from the copy on its own volume, and only the small image crosses
	the network. The node asking picks the holder:

	- this node, when it holds a healthy copy: nothing is sent at all
	- otherwise the online holders, nearest (lowest measured round trip)
	  first, skipping those that lack a tool the format needs (ffmpeg for
	  video) according to their capability manifest

	A file that has no thumbnail (arozfs.ErrNoThumbnail) has none on any
	copy, so that answer ends the search; any other failure moves on to the
	next holder. The bytes of the file itself are never pulled for this.

		POST store/thumbnail  {VolumeID, Path} -> {Image}

	Rendering itself is not this package's business: the core passes
	Option.Thumbnailer, which runs the ordinary renderers on an OS path.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"sort"

	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

const (
	pathThumbnail = acn.BasePath + "/store/thumbnail"

	// ThumbnailConcurrency is how many thumbnails one node renders at once,
	// for itself and for the nodes asking it together.
	ThumbnailConcurrency = 2
	// MaxThumbnailBytes is the largest thumbnail a node sends or accepts.
	MaxThumbnailBytes = ChunkSize
)

var (
	// ErrNoThumbnailer is returned by a node that was started without a
	// thumbnail renderer.
	ErrNoThumbnailer = errors.New("this node does not render thumbnails")
	// ErrNoThumbnailHolder is returned when no online node holding a copy
	// can render the thumbnail (e.g. none of them has ffmpeg for a video).
	ErrNoThumbnailHolder = errors.New("no online node holding a copy can render this thumbnail")
)

type ThumbnailRequest struct {
	VolumeID string `json:"volumeId"`
	Path     string `json:"path"`
}

type ThumbnailResponse struct {
	Image []byte `json:"image"`
}

// Thumbnail returns the thumbnail of a namespace file, rendered by a node
// holding a copy. feature names a tool the renderer needs ("" for none).
func (s *Service) Thumbnail(ctx context.Context, logical string, feature string) ([]byte, error) {
	if !s.Ready() {
		return nil, metadata.ErrNotInCluster
	}
	rec, err := s.meta.Stat(logical)
	if err != nil {
		return nil, os.ErrNotExist
	}
	if rec.IsDir {
		return nil, arozfs.ErrNoThumbnail
	}
	locs := s.orderedLocations(rec)
	if len(locs) == 0 {
		return nil, ErrNoHealthyCopy
	}
	candidates := s.thumbnailCandidates(locs, feature)
	if len(candidates) == 0 {
		return nil, ErrNoThumbnailHolder
	}

	var lastErr error = ErrNoThumbnailHolder
	for _, loc := range candidates {
		var data []byte
		if loc.NodeID == s.m.NodeID() {
			data, err = s.renderLocalThumbnail(ctx, loc.VolumeID, rec.Path)
		} else {
			data, err = s.remoteThumbnail(ctx, loc, rec.Path)
		}
		if err == nil {
			return data, nil
		}
		if errors.Is(err, arozfs.ErrNoThumbnail) || ctx.Err() != nil {
			return nil, err
		}
		lastErr = err
	}
	return nil, lastErr
}

// thumbnailCandidates orders the copies to ask for a thumbnail: this node
// first, then the other holders nearest first, leaving out the nodes that
// lack the feature. One entry per node, as a node renders any of its copies.
func (s *Service) thumbnailCandidates(locs []metadata.Location, feature string) []metadata.Location {
	views := map[string]struct {
		latency float64
		capable bool
	}{}
	for _, n := range s.m.NodeViews() {
		capable := feature == "" || n.Capabilities.Has(feature)
		views[n.ID] = struct {
			latency float64
			capable bool
		}{n.LatencyMs, capable}
	}

	me := s.m.NodeID()
	seen := map[string]bool{}
	local := []metadata.Location{}
	remote := []metadata.Location{}
	for _, loc := range locs {
		if seen[loc.NodeID] {
			continue
		}
		view, known := views[loc.NodeID]
		if !known || !view.capable {
			continue
		}
		seen[loc.NodeID] = true
		if loc.NodeID == me {
			local = append(local, loc)
		} else {
			remote = append(remote, loc)
		}
	}

	//Nearest first; a node never measured (-1) goes after the measured ones
	sort.SliceStable(remote, func(i, j int) bool {
		a, b := views[remote[i].NodeID].latency, views[remote[j].NodeID].latency
		if (a < 0) != (b < 0) {
			return b < 0
		}
		return a < b
	})
	return append(local, remote...)
}

// renderLocalThumbnail renders the copy on one of this node's volumes.
func (s *Service) renderLocalThumbnail(ctx context.Context, volumeID string, logical string) ([]byte, error) {
	if s.opt.Thumbnailer == nil {
		return nil, ErrNoThumbnailer
	}
	_, real, err := s.localVolumePath(volumeID, logical)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, os.ErrNotExist
	}
	if info.IsDir() {
		return nil, arozfs.ErrNoThumbnail
	}

	select {
	case s.thumbSem <- struct{}{}:
		defer func() { <-s.thumbSem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	data, err := s.opt.Thumbnailer(real)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, arozfs.ErrNoThumbnail
	}
	if len(data) > MaxThumbnailBytes {
		return nil, errors.New("thumbnail too large")
	}
	return data, nil
}

// remoteThumbnail asks the node holding loc to render the thumbnail.
func (s *Service) remoteThumbnail(ctx context.Context, loc metadata.Location, logical string) ([]byte, error) {
	resp, err := s.client.Transport.DoJSON2(ctx, loc.NodeID, http.MethodPost, pathThumbnail,
		ThumbnailRequest{VolumeID: loc.VolumeID, Path: logical})
	if err != nil {
		return nil, err
	}
	if resp.Status == http.StatusUnprocessableEntity {
		return nil, arozfs.ErrNoThumbnail
	}
	if err := resp.Error(); err != nil {
		return nil, err
	}
	var out ThumbnailResponse
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		return nil, err
	}
	if len(out.Image) == 0 {
		return nil, arozfs.ErrNoThumbnail
	}
	if len(out.Image) > MaxThumbnailBytes {
		return nil, errors.New("thumbnail too large")
	}
	return out.Image, nil
}

// handleThumbnail renders a thumbnail of a copy on this node for another one.
func (s *Service) handleThumbnail(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req ThumbnailRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	data, err := s.renderLocalThumbnail(r.Context(), req.VolumeID, req.Path)
	if err != nil {
		switch {
		case errors.Is(err, arozfs.ErrNoThumbnail):
			//The content has no thumbnail: the asking node stops looking
			acn.WriteError(w, http.StatusUnprocessableEntity, err.Error())
		case errors.Is(err, ErrNoThumbnailer):
			acn.WriteError(w, http.StatusNotImplemented, err.Error())
		default:
			acn.WriteError(w, statusFor(err), err.Error())
		}
		return
	}
	acn.WriteJSON(w, ThumbnailResponse{Image: data})
}
