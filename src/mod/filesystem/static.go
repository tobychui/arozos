package filesystem

import (
	"bytes"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"net/url"

	mimetype "github.com/gabriel-vasile/mimetype"
	"imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/shortcut"
	"imuslab.com/arozos/mod/info/logger"
)

// Control Signals for background file operation tasks
const (
	FsOpr_Continue  = 0 //Continue file operations
	FsOpr_Pause     = 1 //Pause and wait until opr back to continue
	FsOpr_Cancel    = 2 //Cancel and finish the file operation
	FsOpr_Error     = 3 //Error occured in recent sections
	FsOpr_Completed = 4 //Operation completed. Delete pending
)

// Structure definations
type FileData struct {
	Filename    string
	Filepath    string
	Realpath    string
	IsDir       bool
	Filesize    int64
	Displaysize string
	ModTime     int64
	IsShared    bool
	Shortcut    *arozfs.ShortcutData //This will return nil or undefined if it is not a shortcut file
}

type TrashedFile struct {
	Filename         string
	Filepath         string
	FileExt          string
	IsDir            bool
	Filesize         int64
	RemoveTimestamp  int64
	RemoveDate       string
	OriginalPath     string
	OriginalFilename string
}

type FileProperties struct {
	VirtualPath    string
	StoragePath    string
	Basename       string
	VirtualDirname string
	StorageDirname string
	Ext            string
	MimeType       string
	Filesize       int64
	Permission     string
	LastModTime    string
	LastModUnix    int64
	IsDirectory    bool
}

/*
	HierarchySpecificConfig Template
*/

type EmptyHierarchySpecificConfig struct {
	HierarchyType string
}

func (e EmptyHierarchySpecificConfig) ResolveVrootPath(string, string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "EmptyHierarchySpecificConfig.ResolveVrootPath", "&e", &e), &out0, &out1)
	return "", nil
}
func (e EmptyHierarchySpecificConfig) ResolveRealPath(string, string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "EmptyHierarchySpecificConfig.ResolveRealPath", "&e", &e), &out0, &out1)
	return "", nil
}

var DefaultEmptyHierarchySpecificConfig = EmptyHierarchySpecificConfig{
	HierarchyType: "placeholder",
}

// Check if the two file system are identical.
func MatchingFileSystem(fsa *FileSystemHandler, fsb *FileSystemHandler) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem", "MatchingFileSystem", "fsa", fsa, "fsb", fsb), &out0)
	return fsa.Filesystem == fsb.Filesystem
}

/*
Get the ID part of a virtual path, return ID, subpath and error

The ID is split off before the subpath is cleaned. Cleaning the whole path
read "user:.." as one ordinary element, so "user:../bob/notes.txt" kept its
".." and every caller joined it onto the requesting user's home folder. A
subpath that climbs above its root is now refused with
arozfs.ErrPathEscapesRoot.
*/
func GetIDFromVirtualPath(vpath string) (out0 string, out1 string, out2 error) {
	defer logger.Out3(logger.In1("filesystem", "GetIDFromVirtualPath", "vpath", vpath), &out0, &out1, &out2)
	if !strings.Contains(vpath, ":") {
		return "", "", errors.New("Path missing Virtual Device ID. Given: " + vpath)
	}

	vdID, subpath, _ := strings.Cut(arozfs.ToSlash(vpath), ":")
	//Older code passed paths through filepath.Clean, which prefixes "./"
	vdID = strings.TrimPrefix(vdID, "./")
	if arozfs.SubpathEscapesRoot(subpath) {
		return "", "", arozfs.ErrPathEscapesRoot
	}
	if subpath != "" {
		//A bare root ("user:/") still gives an empty subpath, as before
		subpath = strings.TrimSuffix(path.Clean(subpath), "/")
	}
	return vdID, subpath, nil
}

func GetFileDataFromPath(fsh *FileSystemHandler, vpath string, realpath string, sizeRounding int) (out0 FileData) {
	defer logger.Out1(logger.In4("filesystem", "GetFileDataFromPath", "fsh", fsh, "vpath", vpath, "realpath", realpath, "sizeRounding", sizeRounding), &out0)
	fileSize := fsh.FileSystemAbstraction.GetFileSize(realpath)
	displaySize := GetFileDisplaySize(fileSize, sizeRounding)
	modtime, _ := fsh.FileSystemAbstraction.GetModTime(realpath)

	var shortcutInfo *arozfs.ShortcutData = nil
	if filepath.Ext(realpath) == ".shortcut" {
		shortcutContent, err := fsh.FileSystemAbstraction.ReadFile(realpath)
		if err != nil {
			logger.DebugErr("filesystem", err)
			shortcutInfo = nil
		} else {
			shortcutInfo, err = shortcut.ReadShortcut(shortcutContent)
			if err != nil {
				logger.DebugErr("filesystem", err)
				shortcutInfo = nil
			}
		}
	}

	return FileData{
		Filename:    filepath.Base(realpath),
		Filepath:    vpath,
		Realpath:    filepath.ToSlash(realpath),
		IsDir:       fsh.FileSystemAbstraction.IsDir(realpath),
		Filesize:    fileSize,
		Displaysize: displaySize,
		ModTime:     modtime,
		IsShared:    false,
		Shortcut:    shortcutInfo,
	}

}

func CheckMounted(mountpoint string) (out0 bool) {
	defer logger.Out1(logger.In1("filesystem", "CheckMounted", "mountpoint", mountpoint), &out0)
	if runtime.GOOS == "windows" {
		//Windows
		//Check if the given folder exists
		info, err := os.Stat(mountpoint)
		if os.IsNotExist(err) {
			return false
		}
		return info.IsDir()
	} else {
		//Linux
		cmd := exec.Command("mountpoint", mountpoint)
		out, err := cmd.CombinedOutput()
		if err != nil {
			logger.DebugErr("filesystem", err)
			return false
		}
		outstring := strings.TrimSpace(string(out))
		if strings.Contains(outstring, " is a mountpoint") {
			return true
		} else {
			return false
		}
	}
}

func MountDevice(mountpt string, mountdev string, filesystem string) (out0 error) {
	defer logger.Out1(logger.In3("filesystem", "MountDevice", "mountpt", mountpt, "mountdev", mountdev, "filesystem", filesystem), &out0)
	//Check if running under sudo mode and in linux
	if runtime.GOOS == "linux" {
		//Try to mount the file system
		if mountdev == "" {
			return errors.New("Disk with automount enabled has no mountdev value: " + mountpt)
		}

		if mountpt == "" {
			return errors.New("Invalid storage.json. Mount point not given or not exists for " + mountdev)
		}

		//Check if device exists
		if !FileExists(mountdev) {
			//Device driver not exists.
			return errors.New("Device not exists: " + mountdev)
		}
		//Mount the device
		if CheckMounted(mountpt) {
			logger.PrintAndLog("Filesystem", mountpt+" already mounted.", nil)
		} else {
			logger.PrintAndLog("Filesystem", "Mounting "+mountdev+"("+filesystem+") to "+filepath.Clean(mountpt), nil)
			cmd := exec.Command("mount", "-t", filesystem, mountdev, filepath.Clean(mountpt))
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			cmd.Run()
		}

		//Check if the path exists
		if !FileExists(mountpt) {
			//Mounted but path still not found. Skip this device
			return errors.New("Unable to find " + mountpt)
		}

	} else {
		return errors.New("Unsupported platform")
	}

	return nil
}

// ResolveDeviceByUUID tries to find a block device path (e.g. /dev/sdb1) by its
// partition UUID using blkid. Linux only. Returns an error if the UUID is not found.
func ResolveDeviceByUUID(partUUID string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "ResolveDeviceByUUID", "partUUID", partUUID), &out0, &out1)
	if runtime.GOOS != "linux" {
		return "", errors.New("UUID-based device lookup is only supported on Linux")
	}
	if partUUID == "" {
		return "", errors.New("empty UUID given")
	}
	cmd := exec.Command("blkid", "-U", partUUID)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		logger.DebugErr("filesystem", err)
		return "", fmt.Errorf("device with UUID %s not found: %v", partUUID, err)
	}
	devPath := strings.TrimSpace(out.String())
	if devPath == "" {
		return "", fmt.Errorf("UUID %s did not resolve to any device", partUUID)
	}
	return devPath, nil
}

func GetFileSize(filename string) (out0 int64) {
	defer logger.Out1(logger.In1("filesystem", "GetFileSize", "filename", filename), &out0)
	fi, err := os.Stat(filename)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return 0
	}
	// get the size
	return fi.Size()
}

func IsInsideHiddenFolder(path string) (out0 bool) {
	defer logger.Out1(logger.In1("filesystem", "IsInsideHiddenFolder", "path", path), &out0)
	thisPathInfo := filepath.ToSlash(filepath.Clean(path))
	pathData := strings.Split(thisPathInfo, "/")
	for _, thispd := range pathData {
		if len(thispd) > 0 && thispd[:1] == "." {
			//This path contain one of the folder is hidden
			return true
		}
	}
	return false
}

/*
Wildcard Replacement Glob, design to hanle path with [ or ] inside.
You can also pass in normal path for globing if you are not sure.
*/
func WGlob(path string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "WGlob", "path", path), &out0, &out1)
	files, err := filepath.Glob(path)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return []string{}, err
	}

	if strings.Contains(path, "[") == true || strings.Contains(path, "]") == true {
		if len(files) == 0 {
			//Handle reverse check. Replace all [ and ] with ?
			newSearchPath := strings.ReplaceAll(path, "[", "?")
			newSearchPath = strings.ReplaceAll(newSearchPath, "]", "?")
			//Scan with all the similar structure except [ and ]
			tmpFilelist, _ := filepath.Glob(newSearchPath)
			for _, file := range tmpFilelist {
				file = filepath.ToSlash(file)
				if strings.Contains(file, filepath.ToSlash(filepath.Dir(path))) {
					files = append(files, file)
				}
			}
		}
	}
	//Convert all filepaths to slash
	for i := 0; i < len(files); i++ {
		files[i] = filepath.ToSlash(files[i])
	}
	return files, nil
}

/*
Get Directory Size with native syscall (local drive only)
faster than GetDirectorySize if system support du
*/
func GetDirectorySizeNative(filename string) (out0 int64, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "GetDirectorySizeNative", "filename", filename), &out0, &out1)
	d, err := apt.PackageExists("du")
	if err != nil || !d {
		return 0, err
	}

	//Convert the filename to absolute path
	abspath, err := filepath.Abs(filename)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return 0, err
	}

	//du command exists
	//use native syscall to get disk size
	cmd := exec.Command("du", "-sb", abspath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		logger.DebugErr("filesystem", err)
		return 0, err
	}

	//Return value is something like 481491222874    /media/storage2
	//We need to trim off the spaces
	tmp := string(out)
	tmp = strings.TrimSpace(tmp)
	tmp = strings.ReplaceAll(tmp, "\t", " ")
	for strings.Contains(tmp, "  ") {
		tmp = strings.ReplaceAll(tmp, "  ", " ")
	}

	chunks := strings.Split(tmp, " ")
	if len(chunks) <= 1 {
		return 0, errors.New("malformed output")
	}

	//The first chunk should be the size in bytes
	size, err := strconv.Atoi(chunks[0])
	if err != nil {
		logger.DebugErr("filesystem", err)
		return 0, errors.New("malformed output")
	}

	return int64(size), nil

}

/*
Get Directory size, require filepath and include Hidden files option(true / false)
Return total file size and file count
*/
func GetDirctorySize(filename string, includeHidden bool) (out0 int64, out1 int) {
	defer logger.Out2(logger.In2("filesystem", "GetDirctorySize", "filename", filename, "includeHidden", includeHidden), &out0, &out1)
	var size int64 = 0
	var fileCount int = 0
	err := filepath.Walk(filename, func(thisFilename string, info os.FileInfo, err error) error {
		if err != nil {
			logger.DebugErr("filesystem", err)
			return err
		}
		if !info.IsDir() {
			if includeHidden {
				//append all into the file count and size
				size += info.Size()
				fileCount++
			} else {
				//Check if this is hidden
				if !IsInsideHiddenFolder(thisFilename) {
					size += info.Size()
					fileCount++
				}

			}

		}
		return err
	})
	if err != nil {
		logger.DebugErr("filesystem", err)
		return 0, fileCount
	}
	return size, fileCount
}

func GetFileDisplaySize(filesize int64, rounding int) (out0 string) {
	defer logger.Out1(logger.In2("filesystem", "GetFileDisplaySize", "filesize", filesize, "rounding", rounding), &out0)
	precisionString := "%." + strconv.Itoa(rounding) + "f"
	bytes := float64(filesize)
	kilobytes := float64(bytes / 1024)
	if kilobytes < 1 {
		return fmt.Sprintf(precisionString, bytes) + "Bytes"
	}

	megabytes := float64(kilobytes / 1024)
	if megabytes < 1 {
		return fmt.Sprintf(precisionString, kilobytes) + "KB"
	}

	gigabytes := float64(megabytes / 1024)
	if gigabytes < 1 {
		return fmt.Sprintf(precisionString, megabytes) + "MB"
	}

	terabytes := float64(gigabytes / 1024)
	if terabytes < 1 {
		return fmt.Sprintf(precisionString, gigabytes) + "GB"
	}

	petabytes := float64(terabytes / 1024)
	if petabytes < 1 {
		return fmt.Sprintf(precisionString, terabytes) + "TB"
	}

	exabytes := float64(petabytes / 1024)
	if exabytes < 1 {
		return fmt.Sprintf(precisionString, petabytes) + "PB"
	}

	zettabytes := float64(exabytes / 1024)
	if zettabytes < 1 {
		return fmt.Sprintf(precisionString, exabytes) + "EB"
	}

	return fmt.Sprintf(precisionString, zettabytes) + "ZB"
}

func DecodeURI(inputPath string) (out0 string) {
	defer logger.Out1(logger.In1("filesystem", "DecodeURI", "inputPath", inputPath), &out0)
	inputPath = strings.ReplaceAll(inputPath, "+", "{{plus_sign}}")
	inputPath, _ = url.QueryUnescape(inputPath)
	inputPath = strings.ReplaceAll(inputPath, "{{plus_sign}}", "+")
	return inputPath
}

func GetMime(filename string) (out0 string, out1 string, out2 error) {
	defer logger.Out3(logger.In1("filesystem", "GetMime", "filename", filename), &out0, &out1, &out2)
	fileMime, err := mimetype.DetectFile(filename)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return mime.TypeByExtension(filepath.Ext(filename)), filepath.Ext(filename), nil
	}
	return fileMime.String(), fileMime.Extension(), nil
}

func GetModTime(filepath string) (out0 int64, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "GetModTime", "filepath", filepath), &out0, &out1)
	f, err := os.Open(filepath)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return -1, err
	}
	statinfo, err := f.Stat()
	if err != nil {
		logger.DebugErr("filesystem", err)
		return -1, err
	}
	f.Close()
	return statinfo.ModTime().Unix(), nil
}

func UnderTheSameRoot(srcAbs string, destAbs string) (out0 bool, out1 error) {
	defer logger.Out2(logger.In2("filesystem", "UnderTheSameRoot", "srcAbs", srcAbs, "destAbs", destAbs), &out0, &out1)
	srcRoot, err := GetPhysicalRootFromPath(srcAbs)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return false, err
	}
	destRoot, err := GetPhysicalRootFromPath(destAbs)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return false, err
	}
	if srcRoot != "" && destRoot != "" {
		if srcRoot == destRoot {
			//apply fast move
			return true, nil
		}
	}

	return false, nil
}

// Get the physical root of a given filepath, e.g. C: or /home
func GetPhysicalRootFromPath(filename string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "GetPhysicalRootFromPath", "filename", filename), &out0, &out1)
	filename, err := filepath.Abs(filename)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return "", err
	}
	if filename[:1] == "/" {
		//Handle cases like /home/pi/foo.txt => return home
		filename = filename[1:]
	}
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "", nil
	}
	filename = filepath.ToSlash(filepath.Clean(filename))
	pathChunks := strings.Split(filename, "/")
	return pathChunks[0], nil
}

func GetFileSHA256Sum(filename string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("filesystem", "GetFileSHA256Sum", "filename", filename), &out0, &out1)
	f, err := os.Open(filename)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		logger.DebugErr("filesystem", err)
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

func GetFileMD5Sum(fsh *FileSystemHandler, rpath string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("filesystem", "GetFileMD5Sum", "fsh", fsh, "rpath", rpath), &out0, &out1)
	file, err := fsh.FileSystemAbstraction.ReadStream(rpath)
	if err != nil {
		logger.DebugErr("filesystem", err)
		return "", err
	}

	h := md5.New()
	if _, err := io.Copy(h, file); err != nil {
		logger.DebugErr("filesystem", err)
		return "", err
	}

	file.Close()
	return hex.EncodeToString(h.Sum(nil)), nil
}
