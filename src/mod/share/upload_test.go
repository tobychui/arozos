package share

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/quota"
	"imuslab.com/arozos/mod/user"
)

func TestNormalizeUploadLinkLimits(t *testing.T) {
	tests := []struct {
		name           string
		maxUploadSize  int64
		quotaTotal     int64
		quotaUsed      int64
		inputFileCount int64
		inputFileSize  int64
		inputTotalSize int64
		wantFileCount  int64
		wantFileSize   int64
		wantTotalSize  int64
		wantErr        bool
	}{
		{
			name:           "clamps to remaining quota and global max upload size",
			maxUploadSize:  75,
			quotaTotal:     100,
			quotaUsed:      50,
			inputFileCount: 20,
			inputFileSize:  500,
			inputTotalSize: 500,
			wantFileCount:  20,
			wantFileSize:   50,
			wantTotalSize:  50,
		},
		{
			name:           "unlimited quota still clamps to global max upload size",
			maxUploadSize:  75,
			quotaTotal:     -1,
			inputFileCount: 20,
			inputFileSize:  500,
			inputTotalSize: 500,
			wantFileCount:  20,
			wantFileSize:   75,
			wantTotalSize:  500,
		},
		{
			name:           "defaults invalid limits",
			maxUploadSize:  0,
			quotaTotal:     -1,
			inputFileCount: 0,
			inputFileSize:  0,
			inputTotalSize: 0,
			wantFileCount:  defaultUploadLinkMaxFileCount,
			wantFileSize:   defaultUploadLinkMaxFileSize,
			wantTotalSize:  defaultUploadLinkMaxTotalSize,
		},
		{
			name:           "rejects exhausted quota",
			maxUploadSize:  100,
			quotaTotal:     100,
			quotaUsed:      100,
			inputFileCount: 10,
			inputFileSize:  10,
			inputTotalSize: 10,
			wantErr:        true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			manager := &Manager{options: Options{MaxUploadSize: tt.maxUploadSize}}
			owner := &user.User{StorageQuota: &quota.QuotaHandler{
				TotalStorageQuota: tt.quotaTotal,
				UsedStorageQuota:  tt.quotaUsed,
			}}
			gotCount, gotFileSize, gotTotalSize, err := manager.normalizeUploadLinkLimits(owner, tt.inputFileCount, tt.inputFileSize, tt.inputTotalSize)
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeUploadLinkLimits() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if gotCount != tt.wantFileCount || gotFileSize != tt.wantFileSize || gotTotalSize != tt.wantTotalSize {
				t.Errorf("normalizeUploadLinkLimits() = (%d, %d, %d), want (%d, %d, %d)",
					gotCount, gotFileSize, gotTotalSize, tt.wantFileCount, tt.wantFileSize, tt.wantTotalSize)
			}
		})
	}
}

func TestParseUploadLinkTTLSeconds(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		fallback int64
		want     int64
		wantErr  bool
	}{
		{
			name:     "default empty value",
			raw:      "",
			fallback: defaultUploadLinkTTLSeconds,
			want:     defaultUploadLinkTTLSeconds,
		},
		{
			name: "valid ttl",
			raw:  "3600",
			want: 3600,
		},
		{
			name:    "zero rejected",
			raw:     "0",
			wantErr: true,
		},
		{
			name:    "too large rejected",
			raw:     "31536001",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseUploadLinkTTLSeconds(tt.raw, tt.fallback)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseUploadLinkTTLSeconds() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if got != tt.want {
				t.Errorf("parseUploadLinkTTLSeconds() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestReserveAnonymousUploadDestinationGeneratesTimestampDuplicateName(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "report.txt"), []byte("existing"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	manager := &Manager{uploadReservedNames: map[string]bool{}}
	targetFs := localfs.NewLocalFileSystemAbstraction("test", root, "user", false)
	destPath, releaseName, err := manager.reserveAnonymousUploadDestination(targetFs, root, "report.txt")
	if err != nil {
		t.Fatalf("reserveAnonymousUploadDestination: %v", err)
	}
	defer releaseName()

	base := filepath.Base(destPath)
	matched, err := regexp.MatchString(`^report_[0-9]{8}-[0-9]{6}(_[0-9]+)?\.txt$`, base)
	if err != nil {
		t.Fatalf("regexp.MatchString: %v", err)
	}
	if !matched {
		t.Fatalf("expected timestamp duplicate filename, got %q", base)
	}
	if base == "report.txt" {
		t.Fatal("duplicate upload destination must not reuse the original filename")
	}
}

func TestReserveAnonymousUploadDestinationRejectsReservedCollision(t *testing.T) {
	root := t.TempDir()
	manager := &Manager{uploadReservedNames: map[string]bool{}}
	targetFs := localfs.NewLocalFileSystemAbstraction("test", root, "user", false)

	first, releaseFirst, err := manager.reserveAnonymousUploadDestination(targetFs, root, "new.txt")
	if err != nil {
		t.Fatalf("first reserveAnonymousUploadDestination: %v", err)
	}
	defer releaseFirst()
	second, releaseSecond, err := manager.reserveAnonymousUploadDestination(targetFs, root, "new.txt")
	if err != nil {
		t.Fatalf("second reserveAnonymousUploadDestination: %v", err)
	}
	defer releaseSecond()

	if first == second {
		t.Fatalf("expected second reservation to choose a different path, got %q", second)
	}
}
