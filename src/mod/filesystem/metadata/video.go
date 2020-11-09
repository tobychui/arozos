package metadata

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"io/ioutil"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/oliamb/cutter"
)

func generateThumbnailForVideo(cacheFolder string, file string, generateOnly bool) (string, error) {
	if !fileExists(file) {
		//The user removed this file before the thumbnail is finished
		return "", errors.New("Source not exists")
	}

	if pkg_exists("ffmpeg") {
		outputFile := cacheFolder + filepath.Base(file) + ".jpg"

		//Get the first thumbnail using ffmpeg
		cmd := exec.Command("ffmpeg", "-i", file, "-ss", "00:00:05.000", "-vframes", "1", "-vf", "scale=-1:480", outputFile)
		//cmd := exec.Command("ffmpeg", "-i", file, "-vf", "thumbnail,scale=-1:480", "-frames:v", "1", cacheFolder+filepath.Base(file)+".jpg")
		_, err := cmd.CombinedOutput()
		if err != nil {
			//log.Println(err.Error())
			return "", err
		}

		//Resize and crop the output image
		if fileExists(outputFile) {
			imageBytes, _ := ioutil.ReadFile(outputFile)
			os.Remove(outputFile)
			img, _, err := image.Decode(bytes.NewReader(imageBytes))
			if err != nil {
				//log.Println(err.Error())
			} else {
				//Crop out the center
				croppedImg, err := cutter.Crop(img, cutter.Config{
					Width:  480,
					Height: 480,
					Mode:   cutter.Centered,
				})

				if err == nil {
					//Write it back to the original file
					out, _ := os.Create(outputFile)
					jpeg.Encode(out, croppedImg, nil)
					out.Close()

				} else {
					//log.Println(err)
				}
			}

		}

		//Finished
		if !generateOnly && fileExists(outputFile) {
			//return the image as well
			ctx, err := getImageAsBase64(outputFile)
			return ctx, err
		} else if !fileExists(outputFile) {
			return "", errors.New("Image generation failed")
		}
		return "", nil
	} else {
		return "", errors.New("FFMpeg not installed. Skipping video thumbnail")
	}
}

func pkg_exists(pkgname string) bool {
	if runtime.GOOS == "windows" {
		//Check if the command already exists in windows path paramters.
		cmd := exec.Command("where", pkgname, "2>", "nul")
		_, err := cmd.CombinedOutput()
		if err != nil {
			return false
		}
		return true
	} else if runtime.GOOS == "linux" {
		cmd := exec.Command("whereis", pkgname)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return false
		}
		packageInfo := strings.Split(strings.TrimSpace(string(out)), ":")
		if len(packageInfo) > 1 && packageInfo[1] != "" {
			return true
		} else {
			return false
		}
	}
	return false
}
