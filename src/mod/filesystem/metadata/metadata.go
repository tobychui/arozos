package metadata

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/fssort"
	hidden "imuslab.com/arozos/mod/filesystem/hidden"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	This package is used to extract meta data from files like mp3 and mp4
	Also support image caching

*/

// RAW image format extensions supported by the system
var RawImageFormats = []string{".arw", ".cr2", ".dng", ".nef", ".raf", ".orf"}

// IsRawImageFile checks if the given file path is a RAW image format
func IsRawImageFile(filePath string) bool {
	ext := strings.ToLower(filepath.Ext(filePath))
	return utils.StringInArray(RawImageFormats, ext)
}

type RenderHandler struct {
	renderingFiles  sync.Map
	renderingFolder sync.Map

	//Drives that render thumbnails where the file is stored (external.go)
	externalFlights  sync.Map //content key -> *renderFlight
	externalFailures sync.Map //content key -> time until it is tried again
}

// Create a new RenderHandler
func NewRenderHandler() *RenderHandler {
	return &RenderHandler{
		renderingFiles:  sync.Map{},
		renderingFolder: sync.Map{},
	}
}

// Build cache for all files (non recursive) for the given filepath
func (rh *RenderHandler) BuildCacheForFolder(fsh *filesystem.FileSystemHandler, vpath string, username string) error {
	fshAbs := fsh.FileSystemAbstraction
	rpath, _ := fshAbs.VirtualPathToRealPath(vpath, username)

	//Get a list of all files inside this path
	fis, err := fshAbs.ReadDir(filepath.ToSlash(filepath.Clean(rpath)))
	if err != nil {
		return err
	}
	for _, fi := range fis {
		//Load Cache in generate mode
		rh.LoadCache(fsh, filepath.Join(rpath, fi.Name()), true)
	}

	if _, ok := thumbnailRendererOf(fsh); ok {
		//This drive has no cache folder of its own
		return nil
	}

	//Check if the cache folder has file. If not, remove it
	cachedFiles, _ := fshAbs.ReadDir(filepath.ToSlash(filepath.Join(filepath.Clean(rpath), "/.metadata/.cache/")))
	if len(cachedFiles) == 0 {
		fshAbs.RemoveAll(filepath.ToSlash(filepath.Join(filepath.Clean(rpath), "/.metadata/.cache/")) + "/")
	}
	return nil
}

func (rh *RenderHandler) LoadCacheAsBytes(fsh *filesystem.FileSystemHandler, vpath string, username string, generateOnly bool) ([]byte, error) {
	fshAbs := fsh.FileSystemAbstraction
	rpath, _ := fshAbs.VirtualPathToRealPath(vpath, username)
	b64, err := rh.LoadCache(fsh, rpath, generateOnly)
	if err != nil {
		return []byte{}, err
	}

	resultingBytes, _ := base64.StdEncoding.DecodeString(b64)
	return resultingBytes, nil
}

// Try to load a cache from file. If not exists, generate it now
func (rh *RenderHandler) LoadCache(fsh *filesystem.FileSystemHandler, rpath string, generateOnly bool) (string, error) {
	if r, ok := thumbnailRendererOf(fsh); ok {
		//Rendered where the file is stored and cached on this host
		return rh.loadExternalCache(r, rpath, generateOnly)
	}

	//Create a cache folder
	fshAbs := fsh.FileSystemAbstraction
	cacheFolder := filepath.ToSlash(filepath.Join(filepath.Clean(filepath.Dir(rpath)), "/.metadata/.cache/") + "/")
	fshAbs.MkdirAll(cacheFolder, 0755)
	hidden.HideFile(filepath.Dir(filepath.Clean(cacheFolder)))
	hidden.HideFile(cacheFolder)

	needsGen, cacheData, err := rh.checkCacheNeeded(fsh, rpath, generateOnly, cacheFolder)
	if err != nil {
		return "", err
	}
	if !needsGen {
		return cacheData, nil
	}

	//Generate
	return rh.generateCache(fsh, cacheFolder, rpath, generateOnly)
}

// checkCacheNeeded checks if cache generation is needed
func (rh *RenderHandler) checkCacheNeeded(fsh *filesystem.FileSystemHandler, rpath string, generateOnly bool, cacheFolder string) (needsGeneration bool, cacheData string, err error) {
	if CacheExists(fsh, rpath) {
		if generateOnly {
			return false, "", nil
		}

		ext := ".jpg"
		if !fsh.FileSystemAbstraction.FileExists(cacheFolder + filepath.Base(rpath) + ".jpg") {
			ext = ".png"
		}

		folderModeTime, _ := fsh.FileSystemAbstraction.GetModTime(rpath)
		cacheImageModeTime, _ := fsh.FileSystemAbstraction.GetModTime(cacheFolder + filepath.Base(rpath) + ext)
		if folderModeTime > cacheImageModeTime {
			fsh.FileSystemAbstraction.Remove(cacheFolder + filepath.Base(rpath) + ext)
			return true, "", nil
		} else {
			counter := 0
			for rh.fileIsBusy(rpath) && counter < 15 {
				counter += 1
				time.Sleep(1 * time.Second)
			}

			if rh.fileIsBusy(rpath) {
				return false, "", errors.New("process racing for cache file")
			}

			ctx, err := getImageAsBase64(fsh, cacheFolder+filepath.Base(rpath)+ext)
			return false, ctx, err
		}

	} else if fsh.ReadOnly {
		return false, "", errors.New("cannot generate thumbnail on readonly file system")
	} else {
		if rh.fileIsBusy(rpath) {
			return false, "", errors.New("process racing for cache file")
		}
	}

	return true, "", nil
}

// Formats with a thumbnail renderer, by the extension of the file
var (
	//Audio formats that might contains id4 thumbnail
	audioThumbnailFormats = []string{".mp3", ".ogg", ".flac"}
	imageThumbnailFormats = []string{".png", ".jpeg", ".jpg", ".webp"}
	//Video formats, extract from the 5 sec mark
	videoThumbnailFormats = []string{".mkv", ".mp4", ".webm", ".ogv", ".avi", ".rmvb"}
	modelThumbnailFormats = []string{".stl", ".obj"}
	//Sliced G-code, which carries a slicer generated preview in its header
	gcodeThumbnailFormats = []string{".gcode", ".gco"}
)

// ThumbnailSupported reports whether a file of this name has a thumbnail
// renderer. Folders are not covered: their preview is built from the
// thumbnails of the files inside them.
func ThumbnailSupported(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, formats := range [][]string{audioThumbnailFormats, imageThumbnailFormats,
		videoThumbnailFormats, modelThumbnailFormats, gcodeThumbnailFormats} {
		if utils.StringInArray(formats, ext) {
			return true
		}
	}
	return IsRawImageFile(filename) || ext == ".psd" || ext == ".svg"
}

// ThumbnailFeature names the host tool a thumbnail of this file needs, or ""
// when the built in renderers are enough. It uses the feature names of the
// cluster capability manifests.
func ThumbnailFeature(filename string) string {
	if utils.StringInArray(videoThumbnailFormats, strings.ToLower(filepath.Ext(filename))) {
		return "ffmpeg"
	}
	return ""
}

func (rh *RenderHandler) generateCache(fsh *filesystem.FileSystemHandler, cacheFolder string, rpath string, generateOnly bool) (string, error) {
	//Cache image not exists. Set this file to busy
	rh.renderingFiles.Store(rpath, "busy")
	defer rh.renderingFiles.Delete(rpath)
	return renderThumbnail(fsh, cacheFolder, rpath, generateOnly)
}

// renderThumbnail picks the renderer for a file and writes its thumbnail into
// cacheFolder, which ends with a slash.
func renderThumbnail(fsh *filesystem.FileSystemHandler, cacheFolder string, rpath string, generateOnly bool) (string, error) {
	ext := strings.ToLower(filepath.Ext(rpath))
	switch {
	case utils.StringInArray(audioThumbnailFormats, ext):
		return generateThumbnailForAudio(fsh, cacheFolder, rpath, generateOnly)
	case utils.StringInArray(imageThumbnailFormats, ext):
		//Generate resized image for images
		return generateThumbnailForImage(fsh, cacheFolder, rpath, generateOnly)
	case IsRawImageFile(rpath):
		//RAW image formats (Sony, Canon, Nikon, etc.)
		return generateThumbnailForRAW(fsh, cacheFolder, rpath, generateOnly)
	case utils.StringInArray(videoThumbnailFormats, ext):
		return generateThumbnailForVideo(fsh, cacheFolder, rpath, generateOnly)
	case utils.StringInArray(modelThumbnailFormats, ext):
		//3D Model Formats
		return generateThumbnailForModel(fsh, cacheFolder, rpath, generateOnly)
	case utils.StringInArray(gcodeThumbnailFormats, ext):
		return generateThumbnailForGcode(fsh, cacheFolder, rpath, generateOnly)
	case ext == ".psd":
		//Photoshop file
		return generateThumbnailForPSD(fsh, cacheFolder, rpath, generateOnly)
	case ext == ".svg":
		return generateThumbnailForSVG(fsh, cacheFolder, rpath, generateOnly)
	}

	//Folder preview renderer
	if fsh.FileSystemAbstraction.IsDir(rpath) && len(filepath.Base(rpath)) > 0 && filepath.Base(rpath)[:1] != "." {
		return generateThumbnailForFolder(fsh, cacheFolder, rpath, generateOnly)
	}

	//Other filters
	return "", errors.New("no supported format")
}

func (rh *RenderHandler) fileIsBusy(path string) bool {
	if rh == nil {
		logger.PrintAndLog("Metadata", "RenderHandler is null!", nil)
		return true
	}
	_, ok := rh.renderingFiles.Load(path)
	if !ok {
		//File path is not being process by another process
		return false
	} else {
		return true
	}
}

func getImageAsBase64(fsh *filesystem.FileSystemHandler, rpath string) (string, error) {
	fshAbs := fsh.FileSystemAbstraction
	content, err := fshAbs.ReadFile(rpath)
	if err != nil {
		return "", err
	}
	encoded := base64.StdEncoding.EncodeToString(content)
	return string(encoded), nil
}

// Load a list of folder cache from websocket, pass in "" (empty string) for default sorting method
func (rh *RenderHandler) HandleLoadCache(w http.ResponseWriter, r *http.Request, fsh *filesystem.FileSystemHandler, rpath string, sortmode string) {
	//Get a list of files pending to be cached and sent
	targetPath := filepath.ToSlash(filepath.Clean(rpath))

	//Check if this path already exists another websocket ongoing connection.
	//If yes, disconnect the oldone
	oldc, ok := rh.renderingFolder.Load(targetPath)
	if ok {
		//Close and remove the old connection
		oldc.(*websocket.Conn).Close()
	}

	fis, err := fsh.FileSystemAbstraction.ReadDir(targetPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error"))
		return
	}

	//Upgrade the connection to websocket
	var upgrader = websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.PrintAndLog("Metadata", fmt.Sprint("upgrade:", err), nil)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error"))
		return
	}

	//Set this realpath as websocket connected
	rh.renderingFolder.Store(targetPath, c)

	//For each file, serve a cached image preview
	errorExists := false
	filesWithoutCache := []string{}

	//Updates implementation 02/10/2021: Load thumbnail of files first before folder and apply user preference sort mode
	if sortmode == "" {
		sortmode = "default"
	}

	sortedFis := fssort.SortDirEntryList(fis, sortmode)

	pendingFiles := []string{}
	pendingFolders := []string{}
	for _, fileInfo := range sortedFis {
		if !fileInfo.IsDir() {
			pendingFiles = append(pendingFiles, filepath.Join(targetPath, fileInfo.Name()))
		} else {
			pendingFolders = append(pendingFolders, filepath.Join(targetPath, fileInfo.Name()))
		}
	}
	pendingFiles = append(pendingFiles, pendingFolders...)
	files := pendingFiles

	//Updated implementation 24/12/2020: Load image with cache first before rendering those without
	for _, file := range files {
		if !CacheExists(fsh, file) {
			//Cache not exists. Render this later
			filesWithoutCache = append(filesWithoutCache, file)
		} else {
			//Cache exists. Send it out first
			cachedImage, err := rh.LoadCache(fsh, file, false)
			if err != nil {

			} else {
				jsonString, _ := json.Marshal([]string{filepath.Base(file), cachedImage})
				err := c.WriteMessage(1, jsonString)
				if err != nil {
					//Connection closed
					errorExists = true
					break
				}
			}
		}
	}

	retryList := []string{}

	//Render the remaining cache files
	for _, file := range filesWithoutCache {
		//Load the image cache
		cachedImage, err := rh.LoadCache(fsh, file, false)
		if err != nil {
			//Unable to load this file's cache. Push it to retry list
			retryList = append(retryList, file)
		} else {
			jsonString, _ := json.Marshal([]string{filepath.Base(file), cachedImage})
			err := c.WriteMessage(1, jsonString)
			if err != nil {
				//Connection closed
				errorExists = true
				break
			}
		}
	}

	//Process the retry list after some wait time
	if len(retryList) > 0 {
		time.Sleep(1000 * time.Millisecond)
		for _, file := range retryList {
			//Load the image cache
			cachedImage, err := rh.LoadCache(fsh, file, false)
			if err != nil {

			} else {
				jsonString, _ := json.Marshal([]string{filepath.Base(file), cachedImage})
				err := c.WriteMessage(1, jsonString)
				if err != nil {
					//Connection closed
					errorExists = true
					break
				}
			}
		}
	}

	//Clear record from syncmap
	if !errorExists {
		//This ended normally. Delete the targetPath
		rh.renderingFolder.Delete(targetPath)
	}
	c.Close()

}

// Check if the cache for a file exists
func CacheExists(fsh *filesystem.FileSystemHandler, file string) bool {
	if r, ok := thumbnailRendererOf(fsh); ok {
		_, found := externalCacheFile(r, file)
		return found
	}
	cacheFolder := filepath.ToSlash(filepath.Join(filepath.Clean(filepath.Dir(file)), "/.metadata/.cache/") + "/")
	return fsh.FileSystemAbstraction.FileExists(cacheFolder+filepath.Base(file)+".jpg") || fsh.FileSystemAbstraction.FileExists(cacheFolder+filepath.Base(file)+".png")
}

// Get cache path for this file, given realpath
func GetCacheFilePath(fsh *filesystem.FileSystemHandler, file string) (string, error) {
	if _, ok := thumbnailRendererOf(fsh); ok {
		//The path is on this host, not on the drive, so no fsh can read it
		return "", errors.New("thumbnail of this drive is not kept on the drive")
	}
	if CacheExists(fsh, file) {
		fshAbs := fsh.FileSystemAbstraction
		cacheFolder := filepath.ToSlash(filepath.Join(filepath.Clean(filepath.Dir(file)), "/.metadata/.cache/") + "/")
		if fshAbs.FileExists(cacheFolder + filepath.Base(file) + ".jpg") {
			return cacheFolder + filepath.Base(file) + ".jpg", nil
		} else if fshAbs.FileExists(cacheFolder + filepath.Base(file) + ".png") {
			return cacheFolder + filepath.Base(file) + ".png", nil
		} else {
			return "", errors.New("Unable to resolve thumbnail cache location")
		}
	} else {
		return "", errors.New("No thumbnail cached for this file")
	}
}

// Remove cache if exists, given realpath
func RemoveCache(fsh *filesystem.FileSystemHandler, file string) error {
	if _, ok := thumbnailRendererOf(fsh); ok {
		//Cached by content, so a moved or changed file never finds a stale
		//thumbnail; unused ones are pruned instead
		return nil
	}
	if CacheExists(fsh, file) {
		cachePath, err := GetCacheFilePath(fsh, file)
		if err != nil {
			return err
		}

		//Remove the thumbnail cache
		os.Remove(cachePath)
		return nil
	} else {
		return errors.New("Thumbnail cache not exists for this file")
	}
}
