package webdav

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/storage"
)

// A real user with a small quota uploads past it through the server
func TestUserCannotUploadPastQuota(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	dir := t.TempDir()
	pool, err := storage.NewStoragePool([]*filesystem.FileSystemHandler{{
		Name:                  "user",
		UUID:                  "user",
		Path:                  dir,
		Hierarchy:             "user",
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("user", dir, "user", false),
	}}, "system")
	if err != nil {
		t.Fatalf("NewStoragePool() = %v", err)
	}
	env.server.userHandler.UpdateStoragePool(pool)
	env.server.userHandler.GetPermissionHandler().NewPermissionGroup("small", false, 10, []string{}, "")
	if err := env.authAgent.CreateUserAccount("quotadav", "pw", []string{"small"}); err != nil {
		t.Fatalf("CreateUserAccount() = %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/webdav/user/big.bin", strings.NewReader(strings.Repeat("x", 100)))
	req.SetBasicAuth("quotadav", "pw")
	w := httptest.NewRecorder()
	env.server.HandleRequest(w, req)

	if w.Code != http.StatusInsufficientStorage {
		t.Errorf("PUT of 100 bytes with a 10 byte quota = %d, want %d", w.Code, http.StatusInsufficientStorage)
	}
	if info, err := os.Stat(filepath.Join(dir, "users", "quotadav", "big.bin")); err == nil {
		t.Errorf("a file of %d bytes was stored past the quota", info.Size())
	}
}
