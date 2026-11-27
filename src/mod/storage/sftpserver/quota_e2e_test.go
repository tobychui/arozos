package sftpserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"imuslab.com/arozos/mod/auth"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/storage/quotafs"
	"imuslab.com/arozos/mod/user"
)

// A real user with a small quota uploads past it through the server
func TestUserCannotUploadPastQuota(t *testing.T) {
	tmp := t.TempDir()
	origDir, _ := os.Getwd()
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("Chdir() = %v", err)
	}
	defer os.Chdir(origDir)

	sysdb, err := db.NewDatabase(filepath.Join(tmp, "system.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase() = %v", err)
	}
	defer sysdb.Close()
	authAgent := auth.NewAuthenticationAgent("testsession", []byte("supersecretkey0123456789"), sysdb, false, nil)
	defer authAgent.Close()
	ph, err := permission.NewPermissionHandler(sysdb)
	if err != nil {
		t.Fatalf("NewPermissionHandler() = %v", err)
	}
	ph.NewPermissionGroup("small", false, 10, []string{}, "")
	if err := authAgent.CreateUserAccount("quotasftp", "pw", []string{"small"}); err != nil {
		t.Fatalf("CreateUserAccount() = %v", err)
	}
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
	shares := shareEntry.NewShareEntryTable(sysdb)
	users, err := user.NewUserHandler(sysdb, authAgent, ph, pool, &shares)
	if err != nil {
		t.Fatalf("NewUserHandler() = %v", err)
	}

	key, err := LoadOrCreateHostKey(filepath.Join(tmp, "host.key"))
	if err != nil {
		t.Fatalf("LoadOrCreateHostKey() = %v", err)
	}
	instance, err := NewSFTPServer(&SFTPConfig{
		ListeningIP:  "127.0.0.1:0",
		HostKey:      key,
		Authenticate: func(username, password, remote string) error { return nil },
		LookupUser: func(username string) (Access, quotafs.Quota, error) {
			userinfo, err := users.GetUserInfoFromUsername(username)
			if err != nil {
				return nil, nil, err
			}
			return userinfo, userinfo.StorageQuota, nil
		},
	})
	if err != nil {
		t.Fatalf("NewSFTPServer() = %v", err)
	}
	defer instance.Close()

	conn, err := ssh.Dial("tcp", instance.listener.Addr().String(), &ssh.ClientConfig{
		User:            "quotasftp",
		Auth:            []ssh.AuthMethod{ssh.Password("pw")},
		HostKeyCallback: ssh.FixedHostKey(key.PublicKey()),
		Timeout:         5 * time.Second,
	})
	if err != nil {
		t.Fatalf("Dial() = %v", err)
	}
	defer conn.Close()
	client, err := sftp.NewClient(conn)
	if err != nil {
		t.Fatalf("NewClient() = %v", err)
	}
	defer client.Close()

	f, err := client.Create("/user/big.bin")
	if err != nil {
		t.Fatalf("Create() = %v", err)
	}
	_, writeErr := f.Write([]byte(strings.Repeat("x", 100)))
	f.Close()

	if writeErr == nil {
		t.Errorf("writing 100 bytes with a 10 byte quota succeeded")
	}
	if info, err := os.Stat(filepath.Join(dir, "users", "quotasftp", "big.bin")); err == nil && info.Size() > 10 {
		t.Errorf("a file of %d bytes was stored past the quota", info.Size())
	}
}
