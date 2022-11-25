package webdavfs

import "io/fs"

type WebdavDirEntry struct {
	finfo fs.FileInfo
}

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) *WebdavDirEntry {
	return &WebdavDirEntry{
		finfo: targetFileInfo,
	}
}

func (de WebdavDirEntry) Name() string {
	return de.finfo.Name()
}

func (de WebdavDirEntry) IsDir() bool {
	return de.finfo.IsDir()
}

func (de WebdavDirEntry) Type() fs.FileMode {
	return de.finfo.Mode()
}

func (de WebdavDirEntry) Info() (fs.FileInfo, error) {
	return de.finfo, nil
}
