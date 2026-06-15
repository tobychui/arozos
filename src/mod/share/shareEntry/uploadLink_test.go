package shareEntry

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func newTestUploadLinkTable(t *testing.T) *UploadLinkTable {
	t.Helper()
	return NewUploadLinkTable(openTempDB(t))
}

func createUploadTarget(t *testing.T, owner string) (*UploadLinkTable, string) {
	t.Helper()
	fsh, root := newTestFSH(t)
	targetDir := filepath.Join(root, "users", owner, "uploads")
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	table := newTestUploadLinkTable(t)
	now := time.Now().Unix()
	link, err := table.CreateNewUploadLink(fsh, "testfsh:/uploads", owner, now, now+3600, 10, 1024, 4096)
	if err != nil {
		t.Fatalf("CreateNewUploadLink: %v", err)
	}
	return table, link.PathHash
}

func TestNewUploadLinkTableLoadsExistingEntries(t *testing.T) {
	database := openTempDB(t)
	firstTable := NewUploadLinkTable(database)
	fsh, root := newTestFSH(t)
	userDir := filepath.Join(root, "users", "alice", "uploads")
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	now := time.Now().Unix()
	link, err := firstTable.CreateNewUploadLink(fsh, "testfsh:/uploads", "alice", now, now+3600, 5, 100, 500)
	if err != nil {
		t.Fatalf("CreateNewUploadLink: %v", err)
	}

	reloaded := NewUploadLinkTable(database)
	got := reloaded.GetUploadLinkFromUUID(link.UUID)
	if got == nil {
		t.Fatal("expected persisted upload link to be loaded")
	}
	if got.TargetVirtualPath != "testfsh:/uploads" || got.Owner != "alice" {
		t.Errorf("unexpected loaded link: %+v", got)
	}
}

func TestListUploadLinksByPathHashAllowsMultipleLinks(t *testing.T) {
	fsh, root := newTestFSH(t)
	userDir := filepath.Join(root, "users", "alice", "uploads")
	if err := os.MkdirAll(userDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	table := newTestUploadLinkTable(t)
	now := time.Now().Unix()
	first, err := table.CreateNewUploadLink(fsh, "testfsh:/uploads", "alice", now, now+3600, 5, 100, 500)
	if err != nil {
		t.Fatalf("first CreateNewUploadLink: %v", err)
	}
	second, err := table.CreateNewUploadLink(fsh, "testfsh:/uploads", "alice", now, now+7200, 10, 200, 1000)
	if err != nil {
		t.Fatalf("second CreateNewUploadLink: %v", err)
	}

	links := table.ListUploadLinksByPathHash(first.PathHash)
	if len(links) != 2 {
		t.Fatalf("expected two links for same path hash, got %d", len(links))
	}
	seen := map[string]bool{}
	for _, link := range links {
		seen[link.UUID] = true
	}
	if !seen[first.UUID] || !seen[second.UUID] {
		t.Errorf("missing one of the expected links: %+v", seen)
	}
}

func TestUploadLinkOptionIsActive(t *testing.T) {
	now := time.Now().Unix()
	tests := []struct {
		name string
		link UploadLinkOption
		want bool
	}{
		{
			name: "active",
			link: UploadLinkOption{ExpiresUnix: now + 10, MaxFileCount: 2, MaxTotalSize: 100, UploadedFileCount: 1, UploadedBytes: 20},
			want: true,
		},
		{
			name: "disabled",
			link: UploadLinkOption{ExpiresUnix: now + 10, Disabled: true},
			want: false,
		},
		{
			name: "expired",
			link: UploadLinkOption{ExpiresUnix: now - 1},
			want: false,
		},
		{
			name: "file count exhausted",
			link: UploadLinkOption{ExpiresUnix: now + 10, MaxFileCount: 2, UploadedFileCount: 2},
			want: false,
		},
		{
			name: "total size exhausted",
			link: UploadLinkOption{ExpiresUnix: now + 10, MaxTotalSize: 100, UploadedBytes: 100},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.link.IsActive(now); got != tt.want {
				t.Errorf("IsActive() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUpdateAndDeleteUploadLink(t *testing.T) {
	table, pathHash := createUploadTarget(t, "alice")
	links := table.ListUploadLinksByPathHash(pathHash)
	if len(links) != 1 {
		t.Fatalf("expected one test link, got %d", len(links))
	}
	link := *links[0]
	link.Disabled = true

	if err := table.UpdateUploadLink(&link); err != nil {
		t.Fatalf("UpdateUploadLink: %v", err)
	}
	if table.GetUploadLinkFromUUID(link.UUID).IsActive(time.Now().Unix()) {
		t.Error("disabled upload link should not be active")
	}

	if err := table.DeleteUploadLinkByUUID(link.UUID); err != nil {
		t.Fatalf("DeleteUploadLinkByUUID: %v", err)
	}
	if got := table.GetUploadLinkFromUUID(link.UUID); got != nil {
		t.Errorf("expected deleted link lookup to return nil, got %+v", got)
	}
}

func TestReserveUploadLimits(t *testing.T) {
	now := time.Now().Unix()
	tests := []struct {
		name                string
		link                UploadLinkOption
		size                int64
		maxUploadSize       int64
		ownerRemainingQuota int64
		wantErr             bool
	}{
		{
			name: "accepted",
			link: UploadLinkOption{UUID: "ok", Owner: "alice", ExpiresUnix: now + 10, MaxFileCount: 2, MaxFileSize: 50, MaxTotalSize: 100},
			size: 40, maxUploadSize: 50, ownerRemainingQuota: 100,
		},
		{
			name: "global size exceeded",
			link: UploadLinkOption{UUID: "global", Owner: "alice", ExpiresUnix: now + 10, MaxFileCount: 2, MaxFileSize: 100, MaxTotalSize: 100},
			size: 60, maxUploadSize: 50, ownerRemainingQuota: 100, wantErr: true,
		},
		{
			name: "link file size exceeded",
			link: UploadLinkOption{UUID: "file", Owner: "alice", ExpiresUnix: now + 10, MaxFileCount: 2, MaxFileSize: 50, MaxTotalSize: 100},
			size: 60, maxUploadSize: 100, ownerRemainingQuota: 100, wantErr: true,
		},
		{
			name: "owner quota exceeded",
			link: UploadLinkOption{UUID: "quota", Owner: "alice", ExpiresUnix: now + 10, MaxFileCount: 2, MaxFileSize: 100, MaxTotalSize: 100},
			size: 60, maxUploadSize: 100, ownerRemainingQuota: 50, wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			table := newTestUploadLinkTable(t)
			link := tt.link
			table.UrlToUploadMap.Store(link.UUID, &link)
			err := table.ReserveUpload(link.UUID, tt.size, now, tt.maxUploadSize, tt.ownerRemainingQuota)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ReserveUpload() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestConcurrentReserveUploadAccounting(t *testing.T) {
	table := newTestUploadLinkTable(t)
	now := time.Now().Unix()
	link := &UploadLinkOption{
		UUID:         "concurrent",
		Owner:        "alice",
		ExpiresUnix:  now + 10,
		MaxFileCount: 2,
		MaxFileSize:  50,
		MaxTotalSize: 80,
	}
	table.UrlToUploadMap.Store(link.UUID, link)

	var wg sync.WaitGroup
	var mu sync.Mutex
	successes := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := table.ReserveUpload(link.UUID, 40, now, 50, 80); err == nil {
				mu.Lock()
				successes++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if successes != 2 {
		t.Fatalf("expected exactly 2 reservations, got %d", successes)
	}
	if got := table.pendingFileCounts[link.UUID]; got != 2 {
		t.Errorf("pendingFileCounts = %d, want 2", got)
	}
	if got := table.pendingBytes[link.UUID]; got != 80 {
		t.Errorf("pendingBytes = %d, want 80", got)
	}
	if got := table.pendingOwnerBytes[link.Owner]; got != 80 {
		t.Errorf("pendingOwnerBytes = %d, want 80", got)
	}

	if err := table.CommitUpload(link.UUID, 40); err != nil {
		t.Fatalf("CommitUpload: %v", err)
	}
	table.ReleaseUpload(link.UUID, 40)
	if got := table.pendingFileCounts[link.UUID]; got != 0 {
		t.Errorf("pendingFileCounts after commit/release = %d, want 0", got)
	}
	if got := table.pendingOwnerBytes[link.Owner]; got != 0 {
		t.Errorf("pendingOwnerBytes after commit/release = %d, want 0", got)
	}
}

func TestDeleteUploadLinkReleasesPendingOwnerBytes(t *testing.T) {
	table := newTestUploadLinkTable(t)
	now := time.Now().Unix()
	link := &UploadLinkOption{
		UUID:         "delete-pending",
		Owner:        "alice",
		ExpiresUnix:  now + 10,
		MaxFileCount: 2,
		MaxFileSize:  100,
		MaxTotalSize: 100,
	}
	table.UrlToUploadMap.Store(link.UUID, link)
	if err := table.Database.Write(UploadLinkTableName, link.UUID, link); err != nil {
		t.Fatalf("database write: %v", err)
	}
	if err := table.ReserveUpload(link.UUID, 40, now, 100, 100); err != nil {
		t.Fatalf("ReserveUpload: %v", err)
	}

	if err := table.DeleteUploadLinkByUUID(link.UUID); err != nil {
		t.Fatalf("DeleteUploadLinkByUUID: %v", err)
	}
	if got := table.pendingOwnerBytes[link.Owner]; got != 0 {
		t.Errorf("pendingOwnerBytes after delete = %d, want 0", got)
	}
}
