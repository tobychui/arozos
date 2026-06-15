package share

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/auth"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/user"
)

type uploadHandlerFixture struct {
	manager *Manager
	table   *shareEntry.UploadLinkTable
	root    string
	user    string
}

func newUploadHandlerFixture(t *testing.T, username string, quota int64) *uploadHandlerFixture {
	t.Helper()
	tmpDir := t.TempDir()
	origDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("Chdir: %v", err)
	}

	database, err := db.NewDatabase(filepath.Join(tmpDir, "system.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	authAgent := auth.NewAuthenticationAgent("testsession", []byte("supersecretkey1234567890"), database, false, nil)
	t.Cleanup(func() {
		authAgent.Close()
		database.Close()
		os.Chdir(origDir)
	})

	ph, err := permission.NewPermissionHandler(database)
	if err != nil {
		t.Fatalf("NewPermissionHandler: %v", err)
	}
	groupName := "uploadtest_" + username
	ph.NewPermissionGroup(groupName, false, quota, []string{"File Manager"}, "Desktop")
	if err := authAgent.CreateUserAccount(username, "password", []string{groupName}); err != nil {
		t.Fatalf("CreateUserAccount: %v", err)
	}

	root := filepath.Join(tmpDir, "storage")
	fsa := localfs.NewLocalFileSystemAbstraction("testfsh", root, "user", false)
	fsh := &filesystem.FileSystemHandler{
		UUID:                  "testfsh",
		Name:                  "test",
		Path:                  root,
		Hierarchy:             "user",
		FileSystemAbstraction: fsa,
	}
	if err := os.MkdirAll(filepath.Join(root, "users", username, "uploads"), 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sp, err := storage.NewStoragePool([]*filesystem.FileSystemHandler{fsh}, "system")
	if err != nil {
		t.Fatalf("NewStoragePool: %v", err)
	}

	shareTable := shareEntry.NewShareEntryTable(database)
	userHandler, err := user.NewUserHandler(database, authAgent, ph, sp, &shareTable)
	if err != nil {
		t.Fatalf("NewUserHandler: %v", err)
	}
	uploadTable := shareEntry.NewUploadLinkTable(database)
	manager := NewShareManager(Options{
		UserHandler:     userHandler,
		UploadLinkTable: uploadTable,
		TmpFolder:       filepath.Join(tmpDir, "tmp"),
		MaxUploadSize:   1024,
	})

	return &uploadHandlerFixture{
		manager: manager,
		table:   uploadTable,
		root:    root,
		user:    username,
	}
}

func (f *uploadHandlerFixture) newLink(t *testing.T, expiresUnix int64, maxFileCount int64, maxFileSize int64, maxTotalSize int64) *shareEntry.UploadLinkOption {
	t.Helper()
	userInfo, err := f.manager.options.UserHandler.GetUserInfoFromUsername(f.user)
	if err != nil {
		t.Fatalf("GetUserInfoFromUsername: %v", err)
	}
	fsh := userInfo.GetRootFSHFromVpathInUserScope("testfsh:/uploads")
	if fsh == nil {
		t.Fatal("test filesystem handler not found")
	}
	link, err := f.table.CreateNewUploadLink(fsh, "testfsh:/uploads", f.user, time.Now().Unix(), expiresUnix, maxFileCount, maxFileSize, maxTotalSize)
	if err != nil {
		t.Fatalf("CreateNewUploadLink: %v", err)
	}
	return link
}

func newMultipartUploadRequest(t *testing.T, linkUUID string, filename string, content []byte) *http.Request {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("part.Write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("writer.Close: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/share/upload/post/"+linkUUID, body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestHandlePublicUploadLinkPostSuccess(t *testing.T) {
	fixture := newUploadHandlerFixture(t, "uploadsuccess", -1)
	link := fixture.newLink(t, time.Now().Unix()+3600, 2, 100, 200)
	req := newMultipartUploadRequest(t, link.UUID, "hello.txt", []byte("hello"))
	rr := httptest.NewRecorder()

	fixture.manager.HandlePublicUploadLinkPost(rr, req, link.UUID)

	if strings.Contains(rr.Body.String(), `"error"`) {
		t.Fatalf("unexpected upload error: %s", rr.Body.String())
	}
	var response map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if response["status"] != "OK" || response["filename"] != "hello.txt" {
		t.Fatalf("unexpected response: %+v", response)
	}
	if !fixture.table.GetUploadLinkFromUUID(link.UUID).IsActive(time.Now().Unix()) {
		t.Fatal("link should remain active after one upload")
	}
	if !localfs.NewLocalFileSystemAbstraction("testfsh", fixture.root, "user", false).FileExists(filepath.Join(fixture.root, "users", fixture.user, "uploads", "hello.txt")) {
		t.Fatal("uploaded file was not written to target folder")
	}
}

func TestHandlePublicUploadLinkPostRejectsInvalidUploads(t *testing.T) {
	tests := []struct {
		name       string
		quota      int64
		filename   string
		content    []byte
		mutateLink func(*shareEntry.UploadLinkOption)
	}{
		{
			name:     "expired link",
			quota:    -1,
			filename: "file.txt",
			content:  []byte("hello"),
			mutateLink: func(link *shareEntry.UploadLinkOption) {
				link.ExpiresUnix = time.Now().Unix() - 1
			},
		},
		{
			name:     "revoked link",
			quota:    -1,
			filename: "file.txt",
			content:  []byte("hello"),
			mutateLink: func(link *shareEntry.UploadLinkOption) {
				link.Disabled = true
			},
		},
		{
			name:     "file size limit",
			quota:    -1,
			filename: "file.txt",
			content:  []byte("toolarge"),
			mutateLink: func(link *shareEntry.UploadLinkOption) {
				link.MaxFileSize = 3
			},
		},
		{
			name:     "total size limit",
			quota:    -1,
			filename: "file.txt",
			content:  []byte("toolarge"),
			mutateLink: func(link *shareEntry.UploadLinkOption) {
				link.MaxTotalSize = 3
			},
		},
		{
			name:     "file count limit",
			quota:    -1,
			filename: "file.txt",
			content:  []byte("hello"),
			mutateLink: func(link *shareEntry.UploadLinkOption) {
				link.MaxFileCount = 1
				link.UploadedFileCount = 1
			},
		},
		{
			name:     "owner quota limit",
			quota:    3,
			filename: "file.txt",
			content:  []byte("hello"),
		},
		{
			name:     "unsafe filename",
			quota:    -1,
			filename: "bad:name.txt",
			content:  []byte("hello"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			username := strings.ReplaceAll(tt.name, " ", "")
			fixture := newUploadHandlerFixture(t, username, tt.quota)
			link := fixture.newLink(t, time.Now().Unix()+3600, 2, 100, 200)
			if tt.mutateLink != nil {
				updated := *link
				tt.mutateLink(&updated)
				if err := fixture.table.UpdateUploadLink(&updated); err != nil {
					t.Fatalf("UpdateUploadLink: %v", err)
				}
				link = &updated
			}

			req := newMultipartUploadRequest(t, link.UUID, tt.filename, tt.content)
			rr := httptest.NewRecorder()
			fixture.manager.HandlePublicUploadLinkPost(rr, req, link.UUID)
			if !strings.Contains(rr.Body.String(), `"error"`) {
				t.Fatalf("expected error response, got %s", rr.Body.String())
			}
		})
	}
}
