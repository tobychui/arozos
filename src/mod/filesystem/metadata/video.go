package metadata

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"os/exec"
	"path/filepath"

	"github.com/oliamb/cutter"
	"imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/filesystem"
)

func generateThumbnailForVideo(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(file) {
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
		if fshAbs.FileExists(outputFile) {
			imageBytes, _ := fshAbs.ReadFile(outputFile)
			fshAbs.Remove(outputFile)
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
					out, _ := fshAbs.Create(outputFile)
					jpeg.Encode(out, croppedImg, nil)
					out.Close()

				} else {
					//log.Println(err)
				}
			}

		}

		//Finished
		if !generateOnly && fshAbs.FileExists(outputFile) {
			//return the image as well
			ctx, err := getImageAsBase64(fsh, outputFile)
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
	installed, _ := apt.PackageExists(pkgname)
	return installed
}
