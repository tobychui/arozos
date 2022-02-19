package metadata

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"imuslab.com/arozos/mod/filesystem/fssort"
	hidden "imuslab.com/arozos/mod/filesystem/hidden"
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
func (rh *RenderHandler) BuildCacheForFolder(path string) error {
	//Get a list of all files inside this path
	files, err := filepath.Glob(filepath.ToSlash(filepath.Clean(path)) + "/*")
	if err != nil {
		return err
	}
	for _, file := range files {
		//Load Cache in generate mode
		rh.LoadCache(file, true)
	}

	//Check if the cache folder has file. If not, remove it
	cachedFiles, _ := filepath.Glob(filepath.ToSlash(filepath.Clean(path)) + "/.cache/*")
	if len(cachedFiles) == 0 {
		os.RemoveAll(filepath.ToSlash(filepath.Clean(path)) + "/.cache/")
	}
	return nil
}

func (rh *RenderHandler) LoadCacheAsBytes(file string, generateOnly bool) ([]byte, error) {
	b64, err := rh.LoadCache(file, generateOnly)
	if err != nil {
		return []byte{}, err
	}

	resultingBytes, _ := base64.StdEncoding.DecodeString(b64)
	return resultingBytes, nil
}

//Try to load a cache from file. If not exists, generate it now
func (rh *RenderHandler) LoadCache(file string, generateOnly bool) (string, error) {
	//Create a cache folder
	cacheFolder := filepath.ToSlash(filepath.Clean(filepath.Dir(file))) + "/.cache/"
	os.Mkdir(cacheFolder, 0755)

	hidden.HideFile(cacheFolder)

	//Check if cache already exists. If yes, return the image from the cache folder
	if CacheExists(file) {
		if generateOnly {
			//Only generate, do not return image
			return "", nil
		}

		//Allow thumbnail to be either jpg or png file
		ext := ".jpg"
		if !fileExists(cacheFolder + filepath.Base(file) + ".jpg") {
			ext = ".png"
		}

		//Updates 02/10/2021: Check if the source file is newer than the cache. Update the cache if true
		if mtime(file) > mtime(cacheFolder+filepath.Base(file)+ext) {
			//File is newer than cache. Delete the cache
			os.Remove(cacheFolder + filepath.Base(file) + ext)
		} else {
			//Check if the file is being writting by another process. If yes, wait for it
			counter := 0
			for rh.fileIsBusy(file) && counter < 15 {
				counter += 1
				time.Sleep(1 * time.Second)
			}

			//Time out and the file is still busy
			if rh.fileIsBusy(file) {
				log.Println("Process racing for cache file. Skipping", file)
				return "", errors.New("Process racing for cache file. Skipping")
			}

			//Read and return the image
			ctx, err := getImageAsBase64(cacheFolder + filepath.Base(file) + ext)
			return ctx, err
		}

	} else {
		//This file not exists yet. Check if it is being hold by another process already
		if rh.fileIsBusy(file) {
			log.Println("Process racing for cache file. Skipping", file)
			return "", errors.New("Process racing for cache file. Skipping")
		}
	}

	//Cache image not exists. Set this file to busy
	rh.renderingFiles.Store(file, "busy")

	//That object not exists. Generate cache image
	id4Formats := []string{".mp3", ".ogg", ".flac"}
	if inArray(id4Formats, strings.ToLower(filepath.Ext(file))) {
		img, err := generateThumbnailForAudio(cacheFolder, file, generateOnly)
		rh.renderingFiles.Delete(file)
		return img, err
	}

	//Generate cache for images
	imageFormats := []string{".png", ".jpeg", ".jpg"}
	if inArray(imageFormats, strings.ToLower(filepath.Ext(file))) {
		img, err := generateThumbnailForImage(cacheFolder, file, generateOnly)
		rh.renderingFiles.Delete(file)
		return img, err
	}

	vidFormats := []string{".mkv", ".mp4", ".webm", ".ogv", ".avi", ".rmvb"}
	if inArray(vidFormats, strings.ToLower(filepath.Ext(file))) {
		img, err := generateThumbnailForVideo(cacheFolder, file, generateOnly)
		rh.renderingFiles.Delete(file)
		return img, err
	}

	modelFormats := []string{".stl", ".obj"}
	if inArray(modelFormats, strings.ToLower(filepath.Ext(file))) {
		img, err := generateThumbnailForModel(cacheFolder, file, generateOnly)
		rh.renderingFiles.Delete(file)
		return img, err
	}

	//Folder preview renderer
	if isDir(file) && len(filepath.Base(file)) > 0 && filepath.Base(file)[:1] != "." {
		img, err := generateThumbnailForFolder(cacheFolder, file, generateOnly)
		rh.renderingFiles.Delete(file)
		return img, err
	}

	//Other filters
	rh.renderingFiles.Delete(file)
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

func getImageAsBase64(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	reader := bufio.NewReader(f)
	content, err := ioutil.ReadAll(reader)
	if err != nil {
		return "", err
	}
	encoded := base64.StdEncoding.EncodeToString(content)
	f.Close()
	return string(encoded), nil
}

//Load a list of folder cache from websocket, pass in "" (empty string) for default sorting method
func (rh *RenderHandler) HandleLoadCache(w http.ResponseWriter, r *http.Request, rpath string, sortmode string) {
	//Get a list of files pending to be cached and sent
	targetPath := filepath.ToSlash(filepath.Clean(rpath))

	//Check if this path already exists another websocket ongoing connection.
	//If yes, disconnect the oldone
	oldc, ok := rh.renderingFolder.Load(targetPath)
	if ok {
		//Close and remove the old connection
		oldc.(*websocket.Conn).Close()
	}

	files, err := specialGlob(targetPath + "/*")
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

	pendingFiles := []string{}
	pendingFolders := []string{}
	for _, file := range files {
		if isDir(file) {
			pendingFiles = append(pendingFiles, file)
		} else {
			pendingFolders = append(pendingFolders, file)
		}
	}
	pendingFiles = append(pendingFiles, pendingFolders...)

	files = fssort.SortFileList(pendingFiles, sortmode)

	//Updated implementation 24/12/2020: Load image with cache first before rendering those without

	for _, file := range files {
		if CacheExists(file) == false {
			//Cache not exists. Render this later
			filesWithoutCache = append(filesWithoutCache, file)
		} else {
			//Cache exists. Send it out first
			cachedImage, err := rh.LoadCache(file, false)
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

	//Render the remaining cache files
	for _, file := range filesWithoutCache {
		//Load the image cache
		cachedImage, err := rh.LoadCache(file, false)
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

	//Clear record from syncmap
	if !errorExists {
		//This ended normally. Delete the targetPath
		rh.renderingFolder.Delete(targetPath)
	}
	c.Close()

}

//Check if the cache for a file exists
func CacheExists(file string) bool {
	cacheFolder := filepath.ToSlash(filepath.Clean(filepath.Dir(file))) + "/.cache/"
	return fileExists(cacheFolder+filepath.Base(file)+".jpg") || fileExists(cacheFolder+filepath.Base(file)+".png")
}

//Get cache path for this file, given realpath
func GetCacheFilePath(file string) (string, error) {
	if CacheExists(file) {
		cacheFolder := filepath.ToSlash(filepath.Clean(filepath.Dir(file))) + "/.cache/"
		if fileExists(cacheFolder + filepath.Base(file) + ".jpg") {
			return cacheFolder + filepath.Base(file) + ".jpg", nil
		} else if fileExists(cacheFolder + filepath.Base(file) + ".png") {
			return cacheFolder + filepath.Base(file) + ".png", nil
		} else {
			return "", errors.New("Unable to resolve thumbnail cache location")
		}
	} else {
		return "", errors.New("No thumbnail cached for this file")
	}
}

//Remove cache if exists, given realpath
func RemoveCache(file string) error {
	if CacheExists(file) {
		cachePath, err := GetCacheFilePath(file)
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

func specialGlob(path string) ([]string, error) {
	files, err := filepath.Glob(path)
	if err != nil {
		return []string{}, err
	}

	if strings.Contains(path, "[") == true || strings.Contains(path, "]") == true {
		if len(files) == 0 {
			//Handle reverse check. Replace all [ and ] with *
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
