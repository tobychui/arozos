package metadata

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
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
	"imuslab.com/arozos/mod/utils"
)

/*
	This package is used to extract meta data from files like mp3 and mp4
	Also support image caching

*/

type RenderHandler struct {
	renderingFiles  sync.Map
	renderingFolder sync.Map
}

//Create a new RenderHandler
func NewRenderHandler() *RenderHandler {
	return &RenderHandler{
		renderingFiles:  sync.Map{},
		renderingFolder: sync.Map{},
	}
}

//Build cache for all files (non recursive) for the given filepath
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

//Try to load a cache from file. If not exists, generate it now
func (rh *RenderHandler) LoadCache(fsh *filesystem.FileSystemHandler, rpath string, generateOnly bool) (string, error) {
	//Create a cache folder
	fshAbs := fsh.FileSystemAbstraction
	cacheFolder := filepath.ToSlash(filepath.Join(filepath.Clean(filepath.Dir(rpath)), "/.metadata/.cache/") + "/")
	fshAbs.MkdirAll(cacheFolder, 0755)
	hidden.HideFile(filepath.Dir(filepath.Clean(cacheFolder)))
	hidden.HideFile(cacheFolder)

	//Check if cache already exists. If yes, return the image from the cache folder
	if CacheExists(fsh, rpath) {
		if generateOnly {
			//Only generate, do not return image
			return "", nil
		}

		//Allow thumbnail to be either jpg or png file
		ext := ".jpg"
		if !fshAbs.FileExists(cacheFolder + filepath.Base(rpath) + ".jpg") {
			ext = ".png"
		}

		//Updates 02/10/2021: Check if the source file is newer than the cache. Update the cache if true
		folderModeTime, _ := fshAbs.GetModTime(rpath)
		cacheImageModeTime, _ := fshAbs.GetModTime(cacheFolder + filepath.Base(rpath) + ext)
		if folderModeTime > cacheImageModeTime {
			//File is newer than cache. Delete the cache
			fshAbs.Remove(cacheFolder + filepath.Base(rpath) + ext)
		} else {
			//Check if the file is being writting by another process. If yes, wait for it
			counter := 0
			for rh.fileIsBusy(rpath) && counter < 15 {
				counter += 1
				time.Sleep(1 * time.Second)
			}

			//Time out and the file is still busy
			if rh.fileIsBusy(rpath) {
				log.Println("Process racing for cache file. Skipping", filepath.Base(rpath))
				return "", errors.New("Process racing for cache file. Skipping")
			}

			//Read and return the image
			ctx, err := getImageAsBase64(fsh, cacheFolder+filepath.Base(rpath)+ext)
			return ctx, err
		}

	} else if fsh.ReadOnly {
		//Not exists, but this Fsh is read only. Return nothing
		return "", errors.New("Cannot generate thumbnail on readonly file system")
	} else {
		//This file not exists yet. Check if it is being hold by another process already
		if rh.fileIsBusy(rpath) {
			log.Println("Process racing for cache file. Skipping", filepath.Base(rpath))
			return "", errors.New("Process racing for cache file. Skipping")
		}
	}

	//Cache image not exists. Set this file to busy
	rh.renderingFiles.Store(rpath, "busy")

	//That object not exists. Generate cache image
	//Audio formats that might contains id4 thumbnail
	id4Formats := []string{".mp3", ".ogg", ".flac"}
	if utils.StringInArray(id4Formats, strings.ToLower(filepath.Ext(rpath))) {
		img, err := generateThumbnailForAudio(fsh, cacheFolder, rpath, generateOnly)
		rh.renderingFiles.Delete(rpath)
		return img, err
	}

	//Generate resized image for images
	imageFormats := []string{".png", ".jpeg", ".jpg"}
	if utils.StringInArray(imageFormats, strings.ToLower(filepath.Ext(rpath))) {
		img, err := generateThumbnailForImage(fsh, cacheFolder, rpath, generateOnly)
		rh.renderingFiles.Delete(rpath)
		return img, err
	}

	//Video formats, extract from the 5 sec mark
	vidFormats := []string{".mkv", ".mp4", ".webm", ".ogv", ".avi", ".rmvb"}
	if utils.StringInArray(vidFormats, strings.ToLower(filepath.Ext(rpath))) {
		img, err := generateThumbnailForVideo(fsh, cacheFolder, rpath, generateOnly)
		rh.renderingFiles.Delete(rpath)
		return img, err
	}

	//3D Model Formats
	modelFormats := []string{".stl", ".obj"}
	if utils.StringInArray(modelFormats, strings.ToLower(filepath.Ext(rpath))) {
		img, err := generateThumbnailForModel(fsh, cacheFolder, rpath, generateOnly)
		rh.renderingFiles.Delete(rpath)
		return img, err
	}

	//Photoshop file
	if strings.ToLower(filepath.Ext(rpath)) == ".psd" {
		img, err := generateThumbnailForPSD(fsh, cacheFolder, rpath, generateOnly)
		rh.renderingFiles.Delete(rpath)
		return img, err
	}

	//Folder preview renderer
	if fshAbs.IsDir(rpath) && len(filepath.Base(rpath)) > 0 && filepath.Base(rpath)[:1] != "." {
		img, err := generateThumbnailForFolder(fsh, cacheFolder, rpath, generateOnly)
		rh.renderingFiles.Delete(rpath)
		return img, err
	}

	//Other filters
	rh.renderingFiles.Delete(rpath)
	return "", errors.New("No supported format")
}

func (rh *RenderHandler) fileIsBusy(path string) bool {
	if rh == nil {
		log.Println("RenderHandler is null!")
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

//Load a list of folder cache from websocket, pass in "" (empty string) for default sorting method
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
		log.Print("upgrade:", err)
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

//Check if the cache for a file exists
func CacheExists(fsh *filesystem.FileSystemHandler, file string) bool {
	cacheFolder := filepath.ToSlash(filepath.Join(filepath.Clean(filepath.Dir(file)), "/.metadata/.cache/") + "/")
	return fsh.FileSystemAbstraction.FileExists(cacheFolder+filepath.Base(file)+".jpg") || fsh.FileSystemAbstraction.FileExists(cacheFolder+filepath.Base(file)+".png")
}

//Get cache path for this file, given realpath
func GetCacheFilePath(fsh *filesystem.FileSystemHandler, file string) (string, error) {
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

//Remove cache if exists, given realpath
func RemoveCache(fsh *filesystem.FileSystemHandler, file string) error {
	if CacheExists(fsh, file) {
		cachePath, err := GetCacheFilePath(fsh, file)
		//log.Println("Removing ", cachePath, err)
		if err != nil {
			return err
		}

		//Remove the thumbnail cache
		os.Remove(cachePath)
		return nil
	} else {
		//log.Println("Cache not exists: ", file)
		return errors.New("Thumbnail cache not exists for this file")
	}
}
