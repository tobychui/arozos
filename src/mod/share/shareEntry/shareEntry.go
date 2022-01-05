package shareEntry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
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
	UUID             string
	FileRealPath     string
	Owner            string
	Accessibles      []string //Use to store username or group names if permission is groups or users
	Permission       string   //Access permission, allow {anyone / signedin / samegroup / groups / users}
	AllowLivePreview bool
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
			FileToUrlMap.Store(shareObject.FileRealPath, shareObject)
			UrlToFileMap.Store(shareObject.UUID, shareObject)
		}

	}

	return &ShareEntryTable{
		FileToUrlMap: &FileToUrlMap,
		UrlToFileMap: &UrlToFileMap,
		Database:     db,
	}
}

func (s *ShareEntryTable) CreateNewShare(rpath string, username string, usergroups []string) (*ShareOption, error) {
	rpath = filepath.ToSlash(filepath.Clean(rpath))
	//Check if source file exists
	if !fs.FileExists(rpath) {
		return nil, errors.New("Unable to find the file on disk")
	}

	//Check if the share already exists. If yes, use the previous link
	val, ok := s.FileToUrlMap.Load(rpath)
	if ok {
		//Exists. Send back the old share url
		ShareOption := val.(*ShareOption)
		return ShareOption, nil

	} else {
		//Create new link for this file
		shareUUID := uuid.NewV4().String()

		//Create a share object
		shareOption := ShareOption{
			UUID:             shareUUID,
			FileRealPath:     rpath,
			Owner:            username,
			Accessibles:      usergroups,
			Permission:       "anyone",
			AllowLivePreview: true,
		}

		//Store results on two map to make sure O(1) Lookup time
		s.FileToUrlMap.Store(rpath, &shareOption)
		s.UrlToFileMap.Store(shareUUID, &shareOption)

		//Write object to database
		s.Database.Write("share", shareUUID, shareOption)

		return &shareOption, nil
	}
}

//Delete the share on this vpath
func (s *ShareEntryTable) DeleteShare(rpath string) error {
	rpath = filepath.ToSlash(filepath.Clean(rpath))

	//Check if the share already exists. If yes, use the previous link
	val, ok := s.FileToUrlMap.Load(rpath)
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
		s.FileToUrlMap.Delete(rpath)

		return nil

	} else {
		//Already deleted from buffered record.
		return nil
	}

}

func (s *ShareEntryTable) GetShareUUIDFromPath(rpath string) string {
	targetShareObject := s.GetShareObjectFromRealPath(rpath)
	if (targetShareObject) != nil {
		return targetShareObject.UUID
	}
	return ""
}

func (s *ShareEntryTable) GetShareObjectFromRealPath(rpath string) *ShareOption {
	rpath = filepath.ToSlash(filepath.Clean(rpath))
	var targetShareOption *ShareOption
	s.FileToUrlMap.Range(func(k, v interface{}) bool {
		filePath := k.(string)
		shareObject := v.(*ShareOption)

		if filepath.ToSlash(filepath.Clean(filePath)) == rpath {
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

func (s *ShareEntryTable) FileIsShared(rpath string) bool {
	shareUUID := s.GetShareUUIDFromPath(rpath)
	return shareUUID != ""
}

func (s *ShareEntryTable) RemoveShareByRealpath(rpath string) error {
	so, ok := s.FileToUrlMap.Load(rpath)
	if ok {
		shareUUID := so.(*ShareOption).UUID
		s.UrlToFileMap.Delete(shareUUID)
		s.FileToUrlMap.Delete(rpath)
		s.Database.Delete("share", shareUUID)
	} else {
		return errors.New("Share with given realpath not exists")
	}
	return nil
}

func (s *ShareEntryTable) RemoveShareByUUID(uuid string) error {
	so, ok := s.UrlToFileMap.Load(uuid)
	if ok {
		s.FileToUrlMap.Delete(so.(*ShareOption).FileRealPath)
		s.UrlToFileMap.Delete(uuid)
		s.Database.Delete("share", uuid)
	} else {
		return errors.New("Share with given uuid not exists")
	}
	return nil
}

func (s *ShareEntryTable) ResolveShareOptionFromVpath(vpath string) (*ShareOption, error) {
	vrootID, subpath, err := filesystem.GetIDFromVirtualPath(vpath)
	if err != nil {
		return nil, errors.New("Unable to resolve virtual path")
	}

	if vrootID != "share" {
		return nil, errors.New("Given path is not share vroot path")
	}

	return s.ResolveShareOptionFromShareSubpath(subpath)
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

func (s *ShareEntryTable) ResolveShareVrootPath(subpath string, username string, usergroup []string) (string, error) {
	//Get a list of accessible files from this user
	subpathElements := strings.Split(filepath.ToSlash(filepath.Clean(subpath))[1:], "/")

	if len(subpathElements) == 0 {
		//Requesting root folder.
		return "", errors.New("This virtual file system router do not support root listing")
	}

	//Analysis the subpath elements
	if len(subpathElements) == 1 {
		return "", errors.New("Redirect: parent")
	} else if len(subpathElements) == 2 {
		//ID only or ID with the target filename
		shareObject := s.GetShareObjectFromUUID(subpathElements[0])
		if shareObject == nil {
			return "", errors.New("Share file not found")
		}

		return shareObject.FileRealPath, nil
	} else if len(subpathElements) > 2 {
		//Loading folder / files inside folder type shares
		shareObject := s.GetShareObjectFromUUID(subpathElements[0])
		folderSubpaths := append([]string{shareObject.FileRealPath}, subpathElements[2:]...)
		targetFolder := filepath.Join(folderSubpaths...)
		return targetFolder, nil
	}

	return "", errors.New("Not implemented")
}

func (s *ShareEntryTable) Walk(subpath string, username string, usergroup []string, fastWalkFunction func(fs.FileData) error) error {
	//Resolve the subpath
	if subpath == "" {
		//List root as a collections of shares
		rootFileList := s.ListRootForUser(username, usergroup)
		for _, fileInRoot := range rootFileList {
			if fs.IsDir(fileInRoot.Realpath) {
				//Walk it
				err := filepath.Walk(fileInRoot.Realpath, func(path string, info os.FileInfo, err error) error {
					relPath, err := filepath.Rel(fileInRoot.Realpath, path)
					if err != nil {
						return err
					}

					thisVpath := filepath.ToSlash(filepath.Join(fileInRoot.Filepath, relPath))
					thisFd := fs.GetFileDataFromPath(thisVpath, path, 2)
					err = fastWalkFunction(thisFd)
					if err != nil {
						return err
					}
					return nil
				})

				return err
			} else {
				//Normal files
				err := fastWalkFunction(fileInRoot)
				if err != nil {
					return err
				}
			}

		}
	} else {
		//List realpath of the system
		rpath, err := s.ResolveShareVrootPath(subpath, username, usergroup)
		if err != nil {
			return err
		}

		vpath := "share:/" + subpath
		err = filepath.Walk(rpath, func(path string, info os.FileInfo, err error) error {
			relPath, err := filepath.Rel(rpath, path)
			if err != nil {
				return err
			}
			thisVpath := filepath.ToSlash(filepath.Join(vpath, relPath))
			thisFd := fs.GetFileDataFromPath(thisVpath, rpath, 2)
			err = fastWalkFunction(thisFd)
			if err != nil {
				return err
			}
			return nil
		})

		return err
	}
	return nil
}

func (s *ShareEntryTable) ListRootForUser(username string, usergroup []string) []fs.FileData {
	//Iterate through all shares in the system to see which of the share is user accessible
	userAccessiableShare := []*ShareOption{}
	s.FileToUrlMap.Range(func(fp, so interface{}) bool {
		fileRealpath := fp.(string)
		thisShareOption := so.(*ShareOption)
		if fs.FileExists(fileRealpath) {
			if thisShareOption.IsAccessibleBy(username, usergroup) {
				userAccessiableShare = append(userAccessiableShare, thisShareOption)
			}
		}
		return true
	})

	results := []fs.FileData{}
	for _, thisShareObject := range userAccessiableShare {
		rpath := thisShareObject.FileRealPath
		thisFile := fs.GetFileDataFromPath("share:/"+thisShareObject.UUID+"/"+filepath.Base(rpath), rpath, 2)
		if thisShareObject.Owner == username {
			thisFile.IsShared = true
		}

		results = append(results, thisFile)
	}

	return results
}
