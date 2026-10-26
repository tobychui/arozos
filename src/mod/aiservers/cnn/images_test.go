package cnn

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClassifyRequestAndResponse(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/classifications" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &gotBody)
		json.NewEncoder(w).Encode(ClassificationResult{
			Object: "image.classification", Model: "mobilenet-v2", Created: 1,
			Image: &Dims{Width: 800, Height: 533},
			Data:  []ClassificationItem{{Label: "cat", Index: 1, Score: 0.9}},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, job, err := c.Classify([]byte("fakejpeg"), "image/jpeg", RequestOptions{Model: "mobilenet-v2", TopK: 3})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if job != nil {
		t.Fatalf("did not expect an async job")
	}
	if gotBody["model"] != "mobilenet-v2" || gotBody["top_k"].(float64) != 3 {
		t.Errorf("unexpected request body: %+v", gotBody)
	}
	img, _ := gotBody["image"].(string)
	if !strings.HasPrefix(img, "data:image/jpeg;base64,") {
		t.Errorf("image not encoded as data URI: %s", img)
	}
	if len(result.Data) != 1 || result.Data[0].Label != "cat" {
		t.Errorf("unexpected result data: %+v", result.Data)
	}
}

func TestDetectRequestEncodesThresholds(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &gotBody)
		json.NewEncoder(w).Encode(DetectionResult{
			Object: "image.detection", Model: "yolo11n",
			Data: []DetectionItem{{Label: "mouse", ClassID: 64, Score: 0.93, Box: Box{X1: 1, Y1: 2, X2: 3, Y2: 4}}},
		})
	}))
	defer srv.Close()

	score := float32(0.25)
	nms := float32(0.45)
	c := NewClient(srv.URL, "", 0)
	result, _, err := c.Detect([]byte("fakejpeg"), "image/jpeg", RequestOptions{Model: "yolo11n", ScoreThreshold: &score, NMSThreshold: &nms})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotBody["score_threshold"].(float64) != 0.25 || gotBody["nms_threshold"].(float64) != 0.45 {
		t.Errorf("thresholds not forwarded: %+v", gotBody)
	}
	if len(result.Data) != 1 || result.Data[0].Box.X2 != 3 {
		t.Errorf("unexpected detection data: %+v", result.Data)
	}
}

func TestSegmentPoseOrientedDecode(t *testing.T) {
	cases := []struct {
		name string
		path string
		call func(c *Client) error
	}{
		{"segment", "/v1/images/segmentations", func(c *Client) error {
			_, _, err := c.Segment([]byte("x"), "image/png", RequestOptions{})
			return err
		}},
		{"pose", "/v1/images/poses", func(c *Client) error {
			_, _, err := c.Pose([]byte("x"), "image/png", RequestOptions{})
			return err
		}},
		{"oriented", "/v1/images/oriented", func(c *Client) error {
			_, _, err := c.Oriented([]byte("x"), "image/png", RequestOptions{})
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

func TestPoseDecodesKeypoints(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(PoseResult{
			Object: "image.pose",
			Data: []PoseItem{{Score: 0.91, Box: Box{X1: 1, Y1: 1, X2: 2, Y2: 2},
				Keypoints: []Keypoint{{Name: "nose", X: 612, Y: 140}}}},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, _, err := c.Pose([]byte("x"), "image/png", RequestOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Data) != 1 || len(result.Data[0].Keypoints) != 1 || result.Data[0].Keypoints[0].Name != "nose" {
		t.Errorf("unexpected pose data: %+v", result.Data)
	}
}

func TestSegmentDecodesMask(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(SegmentationResult{
			Object: "image.segmentation",
			Data: []SegmentationItem{{Label: "person", Box: Box{X1: 16, Y1: 64, X2: 1440, Y2: 1751},
				Mask: Mask{Encoding: "png", Width: 1424, Height: 1687, Origin: Point{X: 16, Y: 64}, Data: "iVBORw0KGgo="}}},
		})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "", 0)
	result, _, err := c.Segment([]byte("x"), "image/png", RequestOptions{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Data) != 1 || result.Data[0].Mask.Encoding != "png" || result.Data[0].Mask.Data == "" {
		t.Errorf("unexpected segmentation data: %+v", result.Data)
	}
}
