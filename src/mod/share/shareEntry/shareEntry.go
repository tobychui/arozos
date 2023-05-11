package shareEntry

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
)

/*
	Share Entry

	This module is designed to isolate the entry operatiosn with the
	handle operations so as to reduce the complexity of recursive import
	during development
*/

type ShareEntryTable struct {
	FileToUrlMap *sync.Map
	UrlToFileMap *sync.Map
	Database     *database.Database
}

type ShareOption struct {
	UUID            string
	PathHash        string //Path Hash, the key for loading a share from vpath and fsh specific config
	FileVirtualPath string
	FileRealPath    string
	Owner           string
	Accessibles     []string //Use to store username or group names if permission is groups or users
	Permission      string   //Access permission, allow {anyone / signedin / samegroup / groups / users}
	IsFolder        bool
}

func NewShareEntryTable(db *database.Database) *ShareEntryTable {
	//Create the share table if not exists
	db.NewTable("share")

	FileToUrlMap := sync.Map{}
	UrlToFileMap := sync.Map{}

	//Load the old share links
	entries, _ := db.ListTable("share")
	for _, keypairs := range entries {
		shareObject := new(ShareOption)
		json.Unmarshal(keypairs[1], &shareObject)
		if shareObject != nil {
			//Append this to the maps
			FileToUrlMap.Store(shareObject.PathHash, shareObject)
			UrlToFileMap.Store(shareObject.UUID, shareObject)
		}

	}

	return &ShareEntryTable{
		FileToUrlMap: &FileToUrlMap,
		UrlToFileMap: &UrlToFileMap,
		Database:     db,
	}
}

func (s *ShareEntryTable) CreateNewShare(srcFsh *filesystem.FileSystemHandler, vpath string, username string, usergroups []string) (*ShareOption, error) {
	rpath, err := srcFsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, username)
	if err != nil {
		return nil, errors.New("Unable to translate path given")
	}

	rpath = filepath.ToSlash(filepath.Clean(rpath))
	//Check if source file exists
	if !srcFsh.FileSystemAbstraction.FileExists(rpath) {
		return nil, errors.New("Unable to find the file on disk")
	}

	sharePathHash, err := GetPathHash(srcFsh, vpath, username)

	if err != nil {
		return nil, err
	}

	//Check if the share already exists. If yes, use the previous link
	val, ok := s.FileToUrlMap.Load(sharePathHash)
	if ok {
		//Exists. Send back the old share url
		ShareOption := val.(*ShareOption)
		return ShareOption, nil

	} else {
		//Create new link for this file
		shareUUID := uuid.NewV4().String()

		//Create a share object
		shareOption := ShareOption{
			UUID:            shareUUID,
			PathHash:        sharePathHash,
			FileVirtualPath: vpath,
			FileRealPath:    rpath,
			Owner:           username,
			Accessibles:     usergroups,
			Permission:      "anyone",
			IsFolder:        srcFsh.FileSystemAbstraction.IsDir(rpath),
		}

		//Store results on two map to make sure O(1) Lookup time
		s.FileToUrlMap.Store(sharePathHash, &shareOption)
		s.UrlToFileMap.Store(shareUUID, &shareOption)

		//Write object to database
		s.Database.Write("share", shareUUID, shareOption)

		return &shareOption, nil
	}
}

//Delete the share on this vpath
func (s *ShareEntryTable) DeleteShareByPathHash(pathhash string) error {
	//Check if the share already exists. If yes, use the previous link
	val, ok := s.FileToUrlMap.Load(pathhash)
	if ok {
		//Exists. Send back the old share url
		uuid := val.(*ShareOption).UUID

		//Remove this from the database
		err := s.Database.Delete("share", uuid)
		if err != nil {
			return err
		}

		//Remove this form the current sync map
		s.UrlToFileMap.Delete(uuid)
		s.FileToUrlMap.Delete(pathhash)

		return nil

	} else {
		//Already deleted from buffered record.
		return nil
	}

}

func (s *ShareEntryTable) DeleteShareByUUID(uuid string) error {
	//Check if the share already exists. If yes, use the previous link
	val, ok := s.UrlToFileMap.Load(uuid)
	if ok {
		//Exists. Send back the old share url
		so := val.(*ShareOption)

		//Remove this from the database
		err := s.Database.Delete("share", so.UUID)
		if err != nil {
			return err
		}

		//Remove this form the current sync map
		s.FileToUrlMap.Delete(so.PathHash)
		s.UrlToFileMap.Delete(uuid)
		return nil

	} else {
		//Already deleted from buffered record.
		return nil
	}
}

func (s *ShareEntryTable) GetShareUUIDFromPathHash(pathhash string) string {
	shareObject := s.GetShareObjectFromPathHash(pathhash)
	if shareObject == nil {
		return ""
	} else {
		return shareObject.UUID
	}
}

func (s *ShareEntryTable) GetShareObjectFromPathHash(pathhash string) *ShareOption {
	var targetShareOption *ShareOption = nil
	s.FileToUrlMap.Range(func(k, v interface{}) bool {
		thisPathhash := k.(string)
		shareObject := v.(*ShareOption)

		if thisPathhash == pathhash {
			targetShareOption = shareObject
		}

		return true
	})

	return targetShareOption
}

func (s *ShareEntryTable) GetShareObjectFromUUID(uuid string) *ShareOption {
	var targetShareOption *ShareOption
	s.UrlToFileMap.Range(func(k, v interface{}) bool {
		thisUuid := k.(string)
		shareObject := v.(*ShareOption)

		if thisUuid == uuid {
			targetShareOption = shareObject
		}

		return true
	})

	return targetShareOption
}

func (s *ShareEntryTable) FileIsShared(pathhash string) bool {
	shareUUID := s.GetShareUUIDFromPathHash(pathhash)
	return shareUUID != ""
}

func (s *ShareEntryTable) RemoveShareByPathHash(pathhash string) error {
	so, ok := s.FileToUrlMap.Load(pathhash)
	if ok {
		shareUUID := so.(*ShareOption).UUID
		s.UrlToFileMap.Delete(shareUUID)
		s.FileToUrlMap.Delete(pathhash)
		s.Database.Delete("share", shareUUID)
	} else {
		return errors.New("Share with given pathhash not exists. Given: " + pathhash)
	}
	return nil
}

func (s *ShareEntryTable) RemoveShareByUUID(uuid string) error {
	so, ok := s.UrlToFileMap.Load(uuid)
	if ok {
		shareOption := so.(*ShareOption)
		s.FileToUrlMap.Delete(shareOption.PathHash)
		s.UrlToFileMap.Delete(uuid)
		s.Database.Delete("share", uuid)
	} else {
		return errors.New("Share with given uuid not exists")
	}
	return nil
}

func (s *ShareEntryTable) ResolveShareOptionFromShareSubpath(subpath string) (*ShareOption, error) {
	subpathElements := strings.Split(filepath.ToSlash(filepath.Clean(subpath))[1:], "/")
	if len(subpathElements) >= 1 {
		shareObject := s.GetShareObjectFromUUID(subpathElements[0])
		if shareObject == nil {
			return nil, errors.New("Invalid subpath")
		} else {
			return shareObject, nil
		}
	} else {
		return nil, errors.New("Invalid subpath")
	}
}

func GetPathHash(fsh *filesystem.FileSystemHandler, vpath string, username string) (string, error) {
	return fsh.GetUniquePathHash(vpath, username)
}
