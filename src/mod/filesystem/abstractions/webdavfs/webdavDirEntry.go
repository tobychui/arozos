package webdavfs

import "imuslab.com/arozos/mod/info/logger"
import "io/fs"

type WebdavDirEntry struct {
	finfo fs.FileInfo
}

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) (out0 *WebdavDirEntry) {
	defer logger.Out1(logger.In1("filesystem/abstractions/webdavfs", "newDirEntryFromFileInfo", "targetFileInfo", targetFileInfo), &out0)
	return &WebdavDirEntry{
		finfo: targetFileInfo,
	}
}

func (de WebdavDirEntry) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/webdavfs", "WebdavDirEntry.Name", "&de", &de), &out0)
	return de.finfo.Name()
}

func (de WebdavDirEntry) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/webdavfs", "WebdavDirEntry.IsDir", "&de", &de), &out0)
	return de.finfo.IsDir()
}

func (de WebdavDirEntry) Type() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/webdavfs", "WebdavDirEntry.Type", "&de", &de), &out0)
	return de.finfo.Mode()
}

func (de WebdavDirEntry) Info() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/webdavfs", "WebdavDirEntry.Info", "&de", &de), &out0, &out1)
	return de.finfo, nil
}
