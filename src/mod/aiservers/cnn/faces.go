package cnn

import "net/http"

// FaceItem is one detected face.
type FaceItem struct {
	Score float64 `json:"score"`
	Box   Box     `json:"box"`
}

// FaceDetectionResult is the response of POST /v1/faces/detections.
type FaceDetectionResult = envelope[FaceItem]

// FaceDetect runs face detection (ultraface-rfb-320, ultraface-slim-320).
func (c *Client) FaceDetect(image []byte, mimeType string, opt RequestOptions) (*FaceDetectionResult, *Job, error) {
	return doImageCall[FaceItem](c, "/v1/faces/detections", newImageRequest(image, mimeType, opt))
}

// LandmarkItem is one face and its landmark points.
type LandmarkItem struct {
	Box    Box     `json:"box"`
	Points []Point `json:"points"`
}

// LandmarkResult is the response of POST /v1/faces/landmarks.
type LandmarkResult = envelope[LandmarkItem]

// FaceLandmarks detects faces and returns their landmark points (pfld).
// Set opt.Cropped to treat the whole input image as a single face crop.
func (c *Client) FaceLandmarks(image []byte, mimeType string, opt RequestOptions) (*LandmarkResult, *Job, error) {
	return doImageCall[LandmarkItem](c, "/v1/faces/landmarks", newImageRequest(image, mimeType, opt))
}

// EmbeddingItem is one face and its embedding vector.
type EmbeddingItem struct {
	Box       Box       `json:"box"`
	Embedding []float32 `json:"embedding"`
	Dim       int       `json:"dim"`
}

// EmbeddingResult is the response of POST /v1/faces/embeddings.
type EmbeddingResult = envelope[EmbeddingItem]

// FaceEmbedding returns an L2-normalized embedding vector per face
// (mbv2facenet). By default embeds the largest face; set opt.Cropped to
// treat the input as a single face crop.
func (c *Client) FaceEmbedding(image []byte, mimeType string, opt RequestOptions) (*EmbeddingResult, *Job, error) {
	return doImageCall[EmbeddingItem](c, "/v1/faces/embeddings", newImageRequest(image, mimeType, opt))
}

// GenderScore is the gender classification for one face.
type GenderScore struct {
	Label      string             `json:"label"`
	Confidence float64            `json:"confidence"`
	Scores     map[string]float64 `json:"scores"`
}

// GenderItem is one face and its gender attributes.
type GenderItem struct {
	Box    Box         `json:"box"`
	Gender GenderScore `json:"gender"`
}

// GenderResult is the response of POST /v1/faces/gender.
type GenderResult = envelope[GenderItem]

// FaceAttributes returns gender attributes per face (gender-mbv2-0.35). The
// upstream API doc names this endpoint /v1/faces/attributes, but the
// deployed server actually registers it under /v1/faces/gender (confirmed
// against a live instance: /v1/faces/attributes -> 404, /v1/faces/gender ->
// reachable) with response object "face.gender". This method targets the
// real route under an ArozOS-friendly name.
func (c *Client) FaceAttributes(image []byte, mimeType string, opt RequestOptions) (*GenderResult, *Job, error) {
	return doImageCall[GenderItem](c, "/v1/faces/gender", newImageRequest(image, mimeType, opt))
}

// ComparisonOptions are the parameters for FaceCompare. The server does not
// support async submission for this endpoint.
type ComparisonOptions struct {
	Model     string   `json:"model,omitempty"`
	Threshold *float32 `json:"threshold,omitempty"`
	ACropped  bool     `json:"a_cropped,omitempty"`
	BCropped  bool     `json:"b_cropped,omitempty"`
}

type comparisonRequest struct {
	Model     string   `json:"model,omitempty"`
	ImageA    string   `json:"image_a"`
	ImageB    string   `json:"image_b"`
	ACropped  bool     `json:"a_cropped,omitempty"`
	BCropped  bool     `json:"b_cropped,omitempty"`
	Threshold *float32 `json:"threshold,omitempty"`
}

// ComparisonResult is the (unwrapped - not an envelope) response of
// POST /v1/faces/comparisons.
type ComparisonResult struct {
	Object     string  `json:"object"`
	Model      string  `json:"model"`
	Created    int64   `json:"created"`
	Similarity float64 `json:"similarity"`
	Same       bool    `json:"same"`
	Threshold  float64 `json:"threshold"`
	BoxA       Box     `json:"box_a"`
	BoxB       Box     `json:"box_b"`
}

// FaceCompare compares two face images (each a photo or a crop) and returns
// their cosine similarity (mbv2facenet).
func (c *Client) FaceCompare(imageA, imageB []byte, mimeA, mimeB string, opt ComparisonOptions) (*ComparisonResult, error) {
	req := comparisonRequest{
		Model:     opt.Model,
		ImageA:    dataURI(imageA, mimeA),
		ImageB:    dataURI(imageB, mimeB),
		ACropped:  opt.ACropped,
		BCropped:  opt.BCropped,
		Threshold: opt.Threshold,
	}
	result := &ComparisonResult{}
	if _, err := c.do(http.MethodPost, "/v1/faces/comparisons", req, result); err != nil {
		return nil, err
	}
	return result, nil
}
