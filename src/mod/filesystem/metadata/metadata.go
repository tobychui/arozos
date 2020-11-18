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

	hidden "imuslab.com/arozos/mod/filesystem/hidden"
)

/*
	This package is used to extract meta data from files like mp3 and mp4
	Also support image caching

*/

type RenderHandler struct {
	renderingFiles  sync.Map
	renderinfFolder sync.Map
}

//Create a new RenderHandler
func NewRenderHandler() *RenderHandler {
	return &RenderHandler{
		renderingFiles:  sync.Map{},
		renderinfFolder: sync.Map{},
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

//Try to load a cache from file. If not exists, generate it now
func (rh *RenderHandler) LoadCache(file string, generateOnly bool) (string, error) {
	//Create a cache folder
	cacheFolder := filepath.ToSlash(filepath.Clean(filepath.Dir(file))) + "/.cache/"
	os.Mkdir(cacheFolder, 0755)
	hidden.HideFile(cacheFolder)

	//Check if cache already exists. If yes, return the image from the cache folder
	if fileExists(cacheFolder + filepath.Base(file) + ".jpg") {
		if generateOnly {
			//Only generate, do not return image
			return "", nil
		}

		//Check if the file is being writting by another process. If yes, wait for it
		counter := 0
		for rh.fileIsBusy(file) && counter < 15 {
			counter += 1
			time.Sleep(1 * time.Second)
		}

		//Time out and the file is still busy
		if rh.fileIsBusy(file) {
			return "", errors.New("Process racing for cache file. Skipping")
		}

		//Read and return the image
		ctx, err := getImageAsBase64(cacheFolder + filepath.Base(file) + ".jpg")
		return ctx, err
	} else {
		//This file not exists yet. Check if it is being hold by another process already
		if rh.fileIsBusy(file) {
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

//Load a list of folder cache from websocket
func (rh *RenderHandler) HandleLoadCache(w http.ResponseWriter, r *http.Request, rpath string) {
	//Get a list of files pending to be cached and sent
	targetPath := filepath.ToSlash(filepath.Clean(rpath))

	//Check if this path already exists another websocket ongoing connection.
	//If yes, disconnect the oldone
	oldc, ok := rh.renderinfFolder.Load(targetPath)
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
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Print("upgrade:", err)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error"))
		return
	}

	//Set this realpath as websocket connected
	rh.renderinfFolder.Store(targetPath, c)

	//For each file, serve a cached image preview
	errorExists := false
	for _, file := range files {
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
		rh.renderinfFolder.Delete(targetPath)
	}
	c.Close()

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
