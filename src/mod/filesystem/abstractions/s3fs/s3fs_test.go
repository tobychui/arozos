package s3fs

import (
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// codedError stands in for an API error the SDK has no type for, such as
// NoSuchKey from CopyObject.
type codedError struct{ code string }

func (e codedError) Error() string     { return "api error " + e.code }
func (e codedError) ErrorCode() string { return e.code }

func TestNotExistMapsMissingObjects(t *testing.T) {
	cases := []struct {
		name    string
		err     error
		missing bool
	}{
		{"HeadObject NotFound", fmt.Errorf("operation error S3: HeadObject: %w", &types.NotFound{}), true},
		{"GetObject NoSuchKey", fmt.Errorf("operation error S3: GetObject: %w", &types.NoSuchKey{}), true},
		{"untyped NoSuchKey", fmt.Errorf("operation error S3: CopyObject: %w", codedError{"NoSuchKey"}), true},
		{"untyped NotFound", codedError{"NotFound"}, true},
		{"missing bucket", fmt.Errorf("operation error S3: GetObject: %w", &types.NoSuchBucket{}), false},
		{"access denied", codedError{"AccessDenied"}, false},
		{"network error", errors.New("dial tcp: connection refused"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := notExist(tc.err)
			if errors.Is(got, os.ErrNotExist) != tc.missing {
				t.Fatalf("errors.Is(notExist(%v), os.ErrNotExist) = %v, want %v", tc.err, !tc.missing, tc.missing)
			}
			if !errors.Is(got, tc.err) {
				t.Errorf("notExist dropped the original error %v", tc.err)
			}
		})
	}
}

func TestNotExistKeepsNil(t *testing.T) {
	if err := notExist(nil); err != nil {
		t.Fatalf("notExist(nil) = %v, want nil", err)
	}
}
