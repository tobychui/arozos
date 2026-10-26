package cnn

// ClassificationItem is one ranked label in a classification response.
type ClassificationItem struct {
	Label string  `json:"label"`
	Index int     `json:"index"`
	Score float64 `json:"score"`
}

// ClassificationResult is the response of POST /v1/images/classifications.
type ClassificationResult = envelope[ClassificationItem]

// Classify runs image classification (e.g. mobilenet-v2, yolo11n-cls).
func (c *Client) Classify(image []byte, mimeType string, opt RequestOptions) (*ClassificationResult, *Job, error) {
	return doImageCall[ClassificationItem](c, "/v1/images/classifications", newImageRequest(image, mimeType, opt))
}

// DetectionItem is one detected object.
type DetectionItem struct {
	Label   string  `json:"label"`
	ClassID int     `json:"class_id"`
	Score   float64 `json:"score"`
	Box     Box     `json:"box"`
}

// DetectionResult is the response of POST /v1/images/detections.
type DetectionResult = envelope[DetectionItem]

// Detect runs object detection (e.g. yolo11n, nanodet-plus-m).
func (c *Client) Detect(image []byte, mimeType string, opt RequestOptions) (*DetectionResult, *Job, error) {
	return doImageCall[DetectionItem](c, "/v1/images/detections", newImageRequest(image, mimeType, opt))
}

// Mask is a per-instance, box-cropped segmentation mask.
type Mask struct {
	Encoding string `json:"encoding"` //"png"
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Origin   Point  `json:"origin"`
	Data     string `json:"data"` //base64-encoded 8-bit grayscale PNG
}

// SegmentationItem is one detected instance plus its mask.
type SegmentationItem struct {
	Label   string  `json:"label"`
	ClassID int     `json:"class_id"`
	Score   float64 `json:"score"`
	Box     Box     `json:"box"`
	Mask    Mask    `json:"mask"`
}

// SegmentationResult is the response of POST /v1/images/segmentations.
type SegmentationResult = envelope[SegmentationItem]

// Segment runs instance segmentation (yolo11n-seg).
func (c *Client) Segment(image []byte, mimeType string, opt RequestOptions) (*SegmentationResult, *Job, error) {
	return doImageCall[SegmentationItem](c, "/v1/images/segmentations", newImageRequest(image, mimeType, opt))
}

// Keypoint is one named pose keypoint (COCO-17 layout).
type Keypoint struct {
	Name string `json:"name"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
}

// PoseItem is one detected person and their keypoints.
type PoseItem struct {
	Score     float64    `json:"score"`
	Box       Box        `json:"box"`
	Keypoints []Keypoint `json:"keypoints"`
}

// PoseResult is the response of POST /v1/images/poses.
type PoseResult = envelope[PoseItem]

// Pose runs pose estimation (yolo11n-pose).
func (c *Client) Pose(image []byte, mimeType string, opt RequestOptions) (*PoseResult, *Job, error) {
	return doImageCall[PoseItem](c, "/v1/images/poses", newImageRequest(image, mimeType, opt))
}

// OrientedItem is one detected object with a rotated bounding polygon.
type OrientedItem struct {
	Label    string  `json:"label"`
	ClassID  int     `json:"class_id"`
	Score    float64 `json:"score"`
	AngleRad float64 `json:"angle_rad"`
	Polygon  []Point `json:"polygon"`
}

// OrientedResult is the response of POST /v1/images/oriented.
type OrientedResult = envelope[OrientedItem]

// Oriented runs oriented (rotated box) detection (yolo11n-obb). Intended for
// aerial/top-down imagery.
func (c *Client) Oriented(image []byte, mimeType string, opt RequestOptions) (*OrientedResult, *Job, error) {
	return doImageCall[OrientedItem](c, "/v1/images/oriented", newImageRequest(image, mimeType, opt))
}
