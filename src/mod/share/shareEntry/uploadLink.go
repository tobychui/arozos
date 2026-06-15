package shareEntry

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
)

const UploadLinkTableName = "share-upload"

type UploadLinkTable struct {
	UrlToUploadMap *sync.Map
	Database       *database.Database

	mu                sync.Mutex
	pendingFileCounts map[string]int64
	pendingBytes      map[string]int64
	pendingOwnerBytes map[string]int64
}

type UploadLinkOption struct {
	UUID              string
	PathHash          string
	TargetVirtualPath string
	TargetRealPath    string
	Owner             string
	CreatedUnix       int64
	ExpiresUnix       int64
	MaxFileCount      int64
	MaxFileSize       int64
	MaxTotalSize      int64
	UploadedFileCount int64
	UploadedBytes     int64
	Disabled          bool
}

func NewUploadLinkTable(db *database.Database) *UploadLinkTable {
	db.NewTable(UploadLinkTableName)

	UrlToUploadMap := sync.Map{}
	entries, _ := db.ListTable(UploadLinkTableName)
	for _, keypairs := range entries {
		uploadObject := new(UploadLinkOption)
		json.Unmarshal(keypairs[1], &uploadObject)
		if uploadObject != nil && uploadObject.UUID != "" {
			UrlToUploadMap.Store(uploadObject.UUID, uploadObject)
		}
	}

	return &UploadLinkTable{
		UrlToUploadMap:    &UrlToUploadMap,
		Database:          db,
		pendingFileCounts: map[string]int64{},
		pendingBytes:      map[string]int64{},
		pendingOwnerBytes: map[string]int64{},
	}
}

func (s *UploadLinkTable) CreateNewUploadLink(srcFsh *filesystem.FileSystemHandler, vpath string, username string, createdUnix int64, expiresUnix int64, maxFileCount int64, maxFileSize int64, maxTotalSize int64) (*UploadLinkOption, error) {
	rpath, err := srcFsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, username)
	if err != nil {
		return nil, errors.New("Unable to translate path given")
	}

	rpath = filepath.ToSlash(filepath.Clean(rpath))
	if !srcFsh.FileSystemAbstraction.FileExists(rpath) {
		return nil, errors.New("Unable to find the folder on disk")
	}
	if !srcFsh.FileSystemAbstraction.IsDir(rpath) {
		return nil, errors.New("Upload link target must be a folder")
	}

	sharePathHash, err := GetPathHash(srcFsh, vpath, username)
	if err != nil {
		return nil, err
	}

	uploadUUID := uuid.NewV4().String()
	uploadOption := UploadLinkOption{
		UUID:              uploadUUID,
		PathHash:          sharePathHash,
		TargetVirtualPath: vpath,
		TargetRealPath:    rpath,
		Owner:             username,
		CreatedUnix:       createdUnix,
		ExpiresUnix:       expiresUnix,
		MaxFileCount:      maxFileCount,
		MaxFileSize:       maxFileSize,
		MaxTotalSize:      maxTotalSize,
		UploadedFileCount: 0,
		UploadedBytes:     0,
		Disabled:          false,
	}

	s.UrlToUploadMap.Store(uploadUUID, &uploadOption)
	err = s.Database.Write(UploadLinkTableName, uploadUUID, uploadOption)
	if err != nil {
		s.UrlToUploadMap.Delete(uploadUUID)
		return nil, err
	}

	return &uploadOption, nil
}

func (s *UploadLinkTable) GetUploadLinkFromUUID(uuid string) *UploadLinkOption {
	if val, ok := s.UrlToUploadMap.Load(uuid); ok {
		return val.(*UploadLinkOption)
	}
	return nil
}

func (s *UploadLinkTable) ListUploadLinksByPathHash(pathHash string) []*UploadLinkOption {
	results := []*UploadLinkOption{}
	s.UrlToUploadMap.Range(func(_, v interface{}) bool {
		thisUploadOption := v.(*UploadLinkOption)
		if thisUploadOption.PathHash == pathHash {
			results = append(results, thisUploadOption)
		}
		return true
	})
	return results
}

func (s *UploadLinkTable) ListUploadLinksByOwner(owner string) []*UploadLinkOption {
	results := []*UploadLinkOption{}
	s.UrlToUploadMap.Range(func(_, v interface{}) bool {
		thisUploadOption := v.(*UploadLinkOption)
		if thisUploadOption.Owner == owner {
			results = append(results, thisUploadOption)
		}
		return true
	})
	return results
}

func (s *UploadLinkTable) DeleteUploadLinkByUUID(uuid string) error {
	val, ok := s.UrlToUploadMap.Load(uuid)
	if !ok {
		return errors.New("Upload link with given uuid not exists")
	}
	link := val.(*UploadLinkOption)
	s.UrlToUploadMap.Delete(uuid)
	s.mu.Lock()
	if pendingBytes := s.pendingBytes[uuid]; pendingBytes > 0 {
		if s.pendingOwnerBytes[link.Owner] <= pendingBytes {
			delete(s.pendingOwnerBytes, link.Owner)
		} else {
			s.pendingOwnerBytes[link.Owner] -= pendingBytes
		}
	}
	delete(s.pendingFileCounts, uuid)
	delete(s.pendingBytes, uuid)
	s.mu.Unlock()
	return s.Database.Delete(UploadLinkTableName, uuid)
}

func (s *UploadLinkTable) UpdateUploadLink(updated *UploadLinkOption) error {
	if updated == nil || updated.UUID == "" {
		return errors.New("Invalid upload link")
	}
	if updated.MaxFileCount > 0 && updated.MaxFileCount < updated.UploadedFileCount {
		return errors.New("Max file count is below current uploaded file count")
	}
	if updated.MaxTotalSize > 0 && updated.MaxTotalSize < updated.UploadedBytes {
		return errors.New("Max total size is below current uploaded size")
	}

	s.UrlToUploadMap.Store(updated.UUID, updated)
	return s.Database.Write(UploadLinkTableName, updated.UUID, updated)
}

func (s *UploadLinkOption) IsActive(nowUnix int64) bool {
	if s == nil || s.Disabled {
		return false
	}
	if s.ExpiresUnix > 0 && nowUnix > s.ExpiresUnix {
		return false
	}
	if s.MaxFileCount > 0 && s.UploadedFileCount >= s.MaxFileCount {
		return false
	}
	if s.MaxTotalSize > 0 && s.UploadedBytes >= s.MaxTotalSize {
		return false
	}
	return true
}

func (s *UploadLinkTable) ReserveUpload(uuid string, size int64, nowUnix int64, maxUploadSize int64, ownerRemainingQuota int64) error {
	if size <= 0 {
		return errors.New("Invalid upload size")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	link := s.GetUploadLinkFromUUID(uuid)
	if link == nil {
		return errors.New("Upload link not exists")
	}
	if !link.IsActive(nowUnix) {
		return errors.New("Upload link expired or disabled")
	}
	if maxUploadSize > 0 && size > maxUploadSize {
		return errors.New("File size too large")
	}
	if link.MaxFileSize > 0 && size > link.MaxFileSize {
		return errors.New("File size exceeds upload link limit")
	}
	if link.MaxFileCount > 0 && link.UploadedFileCount+s.pendingFileCounts[uuid]+1 > link.MaxFileCount {
		return errors.New("Upload link file count limit reached")
	}
	if link.MaxTotalSize > 0 && link.UploadedBytes+s.pendingBytes[uuid]+size > link.MaxTotalSize {
		return errors.New("Upload link total size limit reached")
	}
	if ownerRemainingQuota >= 0 && s.pendingOwnerBytes[link.Owner]+size > ownerRemainingQuota {
		return errors.New("User Storage Quota Exceeded")
	}

	s.pendingFileCounts[uuid]++
	s.pendingBytes[uuid] += size
	s.pendingOwnerBytes[link.Owner] += size
	return nil
}

func (s *UploadLinkTable) CommitUpload(uuid string, size int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	link := s.GetUploadLinkFromUUID(uuid)
	if link == nil {
		return errors.New("Upload link not exists")
	}

	s.releaseUploadLocked(link.Owner, uuid, size)
	link.UploadedFileCount++
	link.UploadedBytes += size
	return s.Database.Write(UploadLinkTableName, uuid, link)
}

func (s *UploadLinkTable) ReleaseUpload(uuid string, size int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	link := s.GetUploadLinkFromUUID(uuid)
	if link == nil {
		return
	}
	s.releaseUploadLocked(link.Owner, uuid, size)
}

func (s *UploadLinkTable) releaseUploadLocked(owner string, uuid string, size int64) {
	if s.pendingFileCounts[uuid] > 0 {
		s.pendingFileCounts[uuid]--
	}
	if s.pendingBytes[uuid] <= size {
		delete(s.pendingBytes, uuid)
	} else {
		s.pendingBytes[uuid] -= size
	}
	if s.pendingOwnerBytes[owner] <= size {
		delete(s.pendingOwnerBytes, owner)
	} else {
		s.pendingOwnerBytes[owner] -= size
	}
	if s.pendingFileCounts[uuid] == 0 {
		delete(s.pendingFileCounts, uuid)
	}
}
