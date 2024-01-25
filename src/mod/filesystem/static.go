package filesystem

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"net/url"

	mimetype "github.com/gabriel-vasile/mimetype"
	"imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/filesystem/shortcut"
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

func (e EmptyHierarchySpecificConfig) ResolveVrootPath(string, string) (string, error) {
	return "", nil
}
func (e EmptyHierarchySpecificConfig) ResolveRealPath(string, string) (string, error) {
	return "", nil
}

var DefaultEmptyHierarchySpecificConfig = EmptyHierarchySpecificConfig{
	HierarchyType: "placeholder",
}

// Check if the two file system are identical.
func MatchingFileSystem(fsa *FileSystemHandler, fsb *FileSystemHandler) bool {
	return fsa.Filesystem == fsb.Filesystem
}

// Get the ID part of a virtual path, return ID, subpath and error
func GetIDFromVirtualPath(vpath string) (string, string, error) {
	if !strings.Contains(vpath, ":") {
		return "", "", errors.New("Path missing Virtual Device ID. Given: " + vpath)
	}

	//Clean up the virutal path
	vpath = arozfs.ToSlash(filepath.Clean(vpath))

	tmp := strings.Split(vpath, ":")
	vdID := tmp[0]
	if strings.HasPrefix(vdID, "./") {
		//For newer go version where Clean return with ./ prefix
		vdID = strings.TrimPrefix(vdID, "./")
	}
	pathSlice := tmp[1:]
	path := strings.Join(pathSlice, ":")
	return vdID, path, nil
}

func GetFileDataFromPath(fsh *FileSystemHandler, vpath string, realpath string, sizeRounding int) FileData {
	fileSize := fsh.FileSystemAbstraction.GetFileSize(realpath)
	displaySize := GetFileDisplaySize(fileSize, sizeRounding)
	modtime, _ := fsh.FileSystemAbstraction.GetModTime(realpath)

	var shortcutInfo *arozfs.ShortcutData = nil
	if filepath.Ext(realpath) == ".shortcut" {
		shortcutContent, err := fsh.FileSystemAbstraction.ReadFile(realpath)
		if err != nil {
			shortcutInfo = nil
		} else {
			shortcutInfo, err = shortcut.ReadShortcut(shortcutContent)
			if err != nil {
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

func CheckMounted(mountpoint string) bool {
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

func MountDevice(mountpt string, mountdev string, filesystem string) error {
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
			log.Println(mountpt + " already mounted.")
		} else {
			log.Println("Mounting " + mountdev + "(" + filesystem + ") to " + filepath.Clean(mountpt))
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

func GetFileSize(filename string) int64 {
	fi, err := os.Stat(filename)
	if err != nil {
		return 0
	}
	// get the size
	return fi.Size()
}

func IsInsideHiddenFolder(path string) bool {
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
func WGlob(path string) ([]string, error) {
	files, err := filepath.Glob(path)
	if err != nil {
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
func GetDirectorySizeNative(filename string) (int64, error) {
	d, err := apt.PackageExists("du")
	if err != nil || !d {
		return 0, err
	}

	//Convert the filename to absolute path
	abspath, err := filepath.Abs(filename)
	if err != nil {
		return 0, err
	}

	//du command exists
	//use native syscall to get disk size
	cmd := exec.Command("du", "-sb", abspath)
	out, err := cmd.CombinedOutput()
	if err != nil {
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
		return 0, errors.New("malformed output")
	}

	return int64(size), nil

}

/*
Get Directory size, require filepath and include Hidden files option(true / false)
Return total file size and file count
*/
func GetDirctorySize(filename string, includeHidden bool) (int64, int) {
	var size int64 = 0
	var fileCount int = 0
	err := filepath.Walk(filename, func(thisFilename string, info os.FileInfo, err error) error {
		if err != nil {
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
		return 0, fileCount
	}
	return size, fileCount
}

func GetFileDisplaySize(filesize int64, rounding int) string {
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

func DecodeURI(inputPath string) string {
	inputPath = strings.ReplaceAll(inputPath, "+", "{{plus_sign}}")
	inputPath, _ = url.QueryUnescape(inputPath)
	inputPath = strings.ReplaceAll(inputPath, "{{plus_sign}}", "+")
	return inputPath
}

func GetMime(filename string) (string, string, error) {
	fileMime, err := mimetype.DetectFile(filename)
	if err != nil {
		return mime.TypeByExtension(filepath.Ext(filename)), filepath.Ext(filename), nil
	}
	return fileMime.String(), fileMime.Extension(), nil
}

func GetModTime(filepath string) (int64, error) {
	f, err := os.Open(filepath)
	if err != nil {
		return -1, err
	}
	statinfo, err := f.Stat()
	if err != nil {
		return -1, err
	}
	f.Close()
	return statinfo.ModTime().Unix(), nil
}

func UnderTheSameRoot(srcAbs string, destAbs string) (bool, error) {
	srcRoot, err := GetPhysicalRootFromPath(srcAbs)
	if err != nil {
		return false, err
	}
	destRoot, err := GetPhysicalRootFromPath(destAbs)
	if err != nil {
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
func GetPhysicalRootFromPath(filename string) (string, error) {
	filename, err := filepath.Abs(filename)
	if err != nil {
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

func GetFileSHA256Sum(filename string) (string, error) {
	f, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

func GetFileMD5Sum(fsh *FileSystemHandler, rpath string) (string, error) {
	file, err := fsh.FileSystemAbstraction.ReadStream(rpath)
	if err != nil {
		return "", err
	}

	h := md5.New()
	if _, err := io.Copy(h, file); err != nil {
		return "", err
	}

	file.Close()
	return hex.EncodeToString(h.Sum(nil)), nil
}
