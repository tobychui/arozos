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
	"time"

	"github.com/gorilla/websocket"
)

/*
	This package is used to extract meta data from files like mp3 and mp4
	Also support image caching

*/

//Build cache for all files (non recursive) for the given filepath
func BuildCacheForFolder(path string) error {
	//Get a list of all files inside this path
	files, err := filepath.Glob(filepath.ToSlash(filepath.Clean(path)) + "/*")
	if err != nil {
		return err
	}
	for _, file := range files {
		//Load Cache in generate mode
		LoadCache(file, true)
	}

	//Check if the cache folder has file. If not, remove it
	cachedFiles, _ := filepath.Glob(filepath.ToSlash(filepath.Clean(path)) + "/.cache/*")
	if len(cachedFiles) == 0 {
		os.RemoveAll(filepath.ToSlash(filepath.Clean(path)) + "/.cache/")
	}
	return nil
}

func LoadCache(file string, generateOnly bool) (string, error) {
	//Try to load a cache from file. If not exists, generate it now
	//Create a cache folder
	cacheFolder := filepath.ToSlash(filepath.Clean(filepath.Dir(file))) + "/.cache/"
	waitFile := cacheFolder + filepath.Base(file) + ".jpg.wait"
	os.Mkdir(cacheFolder, 0755)

	//Check if cache already exists. If yes, return the image from the cache folder
	if fileExists(cacheFolder + filepath.Base(file) + ".jpg") {
		if generateOnly {
			//Only generate, do not return image
			return "", nil
		}

		//Check if this file is being writing in the current instsance
		if fileExists(waitFile) {
			//File is being processing by another process. Wait for it for 15 seconds
			counter := 0
			for fileExists(waitFile) && counter < 15 {
				time.Sleep(1 * time.Second)
				counter++
			}

			if counter >= 15 {
				//Time out. Maybe this is from previous rendering? Remove the wait file
				os.Remove(waitFile)
			}
		}

		//Read and return the image
		ctx, err := getImageAsBase64(cacheFolder + filepath.Base(file) + ".jpg")
		return ctx, err
	}

	//Create a .wait file for other process to refernece

	ioutil.WriteFile(waitFile, []byte(""), 0755)

	//That object not exists. Generate cache image
	id4Formats := []string{".mp3", ".ogg", ".flac"}
	if inArray(id4Formats, strings.ToLower(filepath.Ext(file))) {
		img, err := generateThumbnailForAudio(cacheFolder, file, generateOnly)
		//Remove the wait file
		os.Remove(waitFile)
		return img, err
	}

	//Generate cache for images
	imageFormats := []string{".png", ".jpeg", ".jpg"}
	if inArray(imageFormats, strings.ToLower(filepath.Ext(file))) {
		img, err := generateThumbnailForImage(cacheFolder, file, generateOnly)
		//Remove the wait file
		os.Remove(waitFile)
		return img, err
	}

	vidFormats := []string{".mkv", ".mp4", ".webm", ".ogv", ".avi", ".rmvb"}
	if inArray(vidFormats, strings.ToLower(filepath.Ext(file))) {
		img, err := generateThumbnailForVideo(cacheFolder, file, generateOnly)
		//Remove the wait file
		os.Remove(waitFile)
		return img, err
	}

	//Other filters

	//Remove the wait file
	os.Remove(waitFile)
	return "", errors.New("No supported format")
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
func HandleLoadCache(w http.ResponseWriter, r *http.Request, rpath string) {
	//Get a list of files pending to be cached and sent
	files, err := specialGlob(filepath.ToSlash(filepath.Clean(rpath)) + "/*")
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

	//For each file, serve a cached image preview
	for _, file := range files {
		//Load the image cache
		cachedImage, err := LoadCache(file, false)
		if err != nil {

		} else {
			jsonString, _ := json.Marshal([]string{filepath.Base(file), cachedImage})
			err := c.WriteMessage(1, jsonString)
			if err != nil {
				//Connection closed
				break
			}
		}
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
