package main

/*
	share:/ - files shared with the user

	Mounts the drive of mod/filesystem/abstractions/sharefs into the base
	storage pool, so every user has a share:/ root listing what other users
	shared with them (worked out by the share manager, mod/share/drive.go).
	The File Manager shows it as "Shared with me" above the trash bin rather
	than among the storage devices, and web apps open its files by path like
	those of any other drive.

	The drive is read only, which the file operation handlers already check.
	What a share allows beyond reading - taking a copy - is checked here by
	sharedDriveCopyDenied for the operations that would; the File Manager
	does not offer them for items that disallow it in the first place.
*/

import (
	"encoding/base64"
	"errors"
	"path/filepath"
	"time"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/sharefs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/metadata"
	"imuslab.com/arozos/mod/share"
	"imuslab.com/arozos/mod/user"
)

// sharedDriveResolver hands the drive the share manager's view of what is
// shared with each user. The drive is mounted with the storage pools, before
// FileSystemInit creates the share manager, so it is looked up per call.
type sharedDriveResolver struct{}

func (sharedDriveResolver) Items(username string) []*sharefs.Item {
	if shareManager == nil {
		return nil
	}
	return shareManager.Items(username)
}

// sharedDriveThumbnail renders the thumbnail of a shared file on its owner's
// drive, where the owner's own thumbnail cache is kept
func sharedDriveThumbnail(fsh *fs.FileSystemHandler, rpath string) ([]byte, error) {
	if thumbRenderHandler == nil || !metadata.ThumbnailSupported(rpath) {
		return nil, arozfs.ErrNoThumbnail
	}
	encoded, err := thumbRenderHandler.LoadCache(fsh, rpath, false)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 {
		return nil, arozfs.ErrNoThumbnail
	}
	return data, nil
}

func newSharedDriveHandler() *fs.FileSystemHandler {
	abs := sharefs.New(share.SharedDriveUUID, sharedDriveResolver{}, sharefs.Options{
		Thumbnail: sharedDriveThumbnail,
		BufferDir: filepath.Join(*tmp_directory, "sharefs"),
	})
	return &fs.FileSystemHandler{
		Name:                  "Shared with me",
		UUID:                  share.SharedDriveUUID,
		Path:                  share.SharedDriveUUID + ":/",
		Hierarchy:             "public",
		HierarchyConfig:       fs.DefaultEmptyHierarchySpecificConfig,
		ReadOnly:              true,
		RequireBuffer:         false,
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: abs,
		Filesystem:            "share",
		StartOptions: fs.FileSystemOption{
			Name:       "Shared with me",
			Uuid:       share.SharedDriveUUID,
			Path:       share.SharedDriveUUID + ":/",
			Access:     "readonly",
			Hierarchy:  "public",
			Filesystem: "share",
		},
		RuntimePersistenceConfig: fs.RuntimePersistenceConfig{
			LocalBufferPath: *tmp_directory,
		},
	}
}

// sharedDriveAttach adds the drive to the handlers of the base storage pool,
// unless a configured storage already uses its id
func sharedDriveAttach(handlers []*fs.FileSystemHandler) []*fs.FileSystemHandler {
	for _, fsh := range handlers {
		if fsh.UUID == share.SharedDriveUUID {
			systemWideLogger.PrintAndLog("Storage", "A storage is mounted as "+share.SharedDriveUUID+
				":/, where files shared with each user would appear. Give it another id to enable Shared with me.", nil)
			return handlers
		}
	}
	return append(handlers, newSharedDriveHandler())
}

// sharedDriveCopyDenied returns why a copy of one of the given files cannot be
// taken, or nil: a file shared with the user whose owner does not allow
// downloading it, or the drive root itself.
func sharedDriveCopyDenied(userinfo *user.User, vpaths []string) error {
	for _, vpath := range vpaths {
		fsh, _, err := GetFSHandlerSubpathFromVpath(vpath)
		if err != nil || !share.IsSharedDrive(fsh) {
			continue
		}
		drive := fsh.FileSystemAbstraction.(*sharefs.ShareFileSystem)
		item, err := drive.ItemOf(vpath, userinfo.Username)
		if err != nil {
			return errors.New("Source file not exists")
		}
		if item == nil {
			return errors.New("Shared with me cannot be copied as a whole")
		}
		if !item.CanDownload {
			return errors.New("The owner of " + item.Name + " does not allow downloading it")
		}
	}
	return nil
}
