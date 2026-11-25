package webdavfs

import "imuslab.com/arozos/mod/info/logger"
import "io/fs"

type WebdavDirEntry struct {
	finfo fs.FileInfo
}

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) *WebdavDirEntry {
	logger.DebugTrace("filesystem/abstractions/webdavfs", "newDirEntryFromFileInfo")
	return &WebdavDirEntry{
		finfo: targetFileInfo,
	}
}

func (de WebdavDirEntry) Name() string {
	logger.DebugTrace("filesystem/abstractions/webdavfs", "WebdavDirEntry.Name")
	return de.finfo.Name()
}

func (de WebdavDirEntry) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/webdavfs", "WebdavDirEntry.IsDir")
	return de.finfo.IsDir()
}

func (de WebdavDirEntry) Type() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/webdavfs", "WebdavDirEntry.Type")
	return de.finfo.Mode()
}

func (de WebdavDirEntry) Info() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/webdavfs", "WebdavDirEntry.Info")
	return de.finfo, nil
}
