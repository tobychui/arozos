package cnn

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFaceCompare(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/faces/comparisons" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &gotBody)
		json.NewEncoder(w).Encode(ComparisonResult{Object: "face.comparison", Similarity: 0.62, Same: true, Threshold: 0.5})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, err := c.FaceCompare([]byte("a"), []byte("b"), "image/jpeg", "image/png", ComparisonOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotBody["image_a"] == nil || gotBody["image_b"] == nil {
		t.Errorf("images not sent: %+v", gotBody)
	}
	if !result.Same || result.Similarity != 0.62 {
		t.Errorf("unexpected comparison result: %+v", result)
	}
}

func TestFaceAttributesUsesGenderRoute(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		json.NewEncoder(w).Encode(GenderResult{
			Object: "face.gender",
			Data: []GenderItem{{Gender: GenderScore{Label: "female", Confidence: 0.98,
				Scores: map[string]float64{"female": 0.98, "male": 0.02}}}},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, job, err := c.FaceAttributes([]byte("x"), "image/jpeg", RequestOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if job != nil {
		t.Fatalf("did not expect an async job")
	}
	if gotPath != "/v1/faces/gender" {
		t.Errorf("expected the real /v1/faces/gender route, got %s", gotPath)
	}
	if len(result.Data) != 1 || result.Data[0].Gender.Label != "female" {
		t.Errorf("unexpected gender result: %+v", result.Data)
	}
}

func TestFaceDetectAndLandmarksAndEmbedding(t *testing.T) {
	cases := []struct {
		name string
		path string
		call func(c *Client) error
	}{
		{"detect", "/v1/faces/detections", func(c *Client) error {
			_, _, err := c.FaceDetect([]byte("x"), "image/jpeg", RequestOptions{})
			return err
		}},
		{"landmarks", "/v1/faces/landmarks", func(c *Client) error {
			_, _, err := c.FaceLandmarks([]byte("x"), "image/jpeg", RequestOptions{Cropped: true})
			return err
		}},
		{"embedding", "/v1/faces/embeddings", func(c *Client) error {
			_, _, err := c.FaceEmbedding([]byte("x"), "image/jpeg", RequestOptions{})
			return err
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotPath string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				w.Write([]byte(`{"object":"x","data":[]}`))
			}))
			defer srv.Close()

			c := NewClient(srv.URL, "", 0)
			if err := tc.call(c); err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if gotPath != tc.path {
				t.Errorf("expected path %s, got %s", tc.path, gotPath)
			}
		})
	}
}
