package s3fs

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"imuslab.com/arozos/mod/info/logger"
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

// captureDebug turns debug mode on for one test, sends the system log to a
// file of its own and returns a function that reads what was logged.
func captureDebug(t *testing.T, enabled bool) func() string {
	t.Helper()
	l, err := logger.NewLogger("debug", t.TempDir(), true)
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	logger.SetDefaultLogger(l)
	logger.SetDebug(enabled)
	t.Cleanup(func() {
		logger.SetDebug(false)
		tmp, _ := logger.NewTmpLogger()
		logger.SetDefaultLogger(tmp)
		l.Close()
	})
	return func() string {
		data, err := os.ReadFile(l.CurrentLogFile)
		if err != nil {
			t.Fatalf("ReadFile error: %v", err)
		}
		return string(data)
	}
}

// TestDebugf checks the debug record of a drive, which warns when the drive
// or its client is nil because the next call on it panics.
func TestDebugf(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		drive   *S3FSAbstraction
		want    string
	}{
		{"debug off", false, &S3FSAbstraction{uuid: "s3"}, ""},
		{"nil drive", true, nil, "[S3 FS] Stat \"/a\" [drive is nil, this call will panic]"},
		{"no client", true, &S3FSAbstraction{uuid: "s3", bucket: "b", prefix: "p"}, `[S3 FS] s3:/ (s3://b/p) Stat "/a" [client is nil: the drive is not connected, this call will panic]`},
	}
	for _, tt := range tests {
		read := captureDebug(t, tt.enabled)
		tt.drive.debugf("Stat %q", "/a")
		got := read()
		if (tt.want == "") != (got == "") || !strings.Contains(got, tt.want) {
			t.Errorf("%s: record %q, want %q", tt.name, got, tt.want)
		}
	}
}
