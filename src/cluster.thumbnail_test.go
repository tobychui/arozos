package main

import "testing"

func TestClusterThumbnailKey(t *testing.T) {
	testcases := []struct {
		name     string
		checksum string
		id       string
		size     int64
		modTime  int64
		want     string
	}{
		{"committed file uses its checksum", "abc123", "f1", 10, 100, "cluster-sha256:abc123"},
		{"same content elsewhere shares the key", "abc123", "f2", 10, 999, "cluster-sha256:abc123"},
		{"file being written uses its identity", "", "f1", 10, 100, "cluster-file:f1:10:100"},
		{"a new write changes the key", "", "f1", 11, 101, "cluster-file:f1:11:101"},
	}
	for _, tc := range testcases {
		if got := clusterThumbnailKey(tc.checksum, tc.id, tc.size, tc.modTime); got != tc.want {
			t.Errorf("%s: got %q, wanted %q", tc.name, got, tc.want)
		}
	}
}

func TestClusterIsThumbnailFolder(t *testing.T) {
	testcases := []struct {
		path  string
		isDir bool
		want  bool
	}{
		{"/.metadata/.cache", true, true},
		{"/photos/.metadata/.cache", true, true},
		{"/photos/.metadata/.cache", false, false},
		{"/photos/.metadata", true, false},
		{"/photos/.metadata/.trash", true, false},
		{"/photos/.cache", true, false},
		{"/photos/.metadata/.cache/x.jpg", false, false},
	}
	for _, tc := range testcases {
		if got := clusterIsThumbnailFolder(tc.path, tc.isDir); got != tc.want {
			t.Errorf("clusterIsThumbnailFolder(%q, %v) = %v, wanted %v", tc.path, tc.isDir, got, tc.want)
		}
	}
}
