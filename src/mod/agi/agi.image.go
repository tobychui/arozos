package agi

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/jpeg"
	"image/png"
	_ "image/png"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/oliamb/cutter"
	"github.com/robertkrimen/otto"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/neuralnet"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	AJGI Image Processing Library

	This is a library for handling image related functionalities in agi scripts.

*/

func (g *Gateway) ImageLibRegister() {
	err := g.RegisterLib("imagelib", g.injectImageLibFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectImageLibFunctions(vm *otto.Otto, u *user.User, scriptFsh *filesystem.FileSystemHandler, scriptPath string, w http.ResponseWriter, r *http.Request) {
	//Get image dimension, requires filepath (virtual)
	vm.Set("_imagelib_getImageDimension", func(call otto.FunctionCall) otto.Value {
		imageFileVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		fsh, imagePath, err := virtualPathToRealPath(imageFileVpath, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		if !fsh.FileSystemAbstraction.FileExists(imagePath) {
			g.raiseError(errors.New("File not exists! Given " + imagePath))
			return otto.FalseValue()
		}

		openingPath := imagePath
		var closerFunc func()
		var file arozfs.File
		if fsh.RequireBuffer {
			bufferPath, cf := g.getUserSpecificTempFilePath(u, imagePath)
			closerFunc = cf
			defer closerFunc()
			c, err := fsh.FileSystemAbstraction.ReadFile(imagePath)
			if err != nil {
				g.raiseError(errors.New("Read from file system failed: " + err.Error()))
				return otto.FalseValue()
			}
			os.WriteFile(bufferPath, c, 0775)
			openingPath = bufferPath

			file, err = os.Open(openingPath)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		} else {
			file, err = fsh.FileSystemAbstraction.Open(openingPath)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		}

		image, _, err := image.DecodeConfig(file)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}
		file.Close()
		rawResults := []int{image.Width, image.Height}
		result, _ := vm.ToValue(rawResults)
		return result
	})

	//Resize image, require (filepath, outputpath, width, height)
	vm.Set("_imagelib_resizeImage", func(call otto.FunctionCall) otto.Value {
		vsrc, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		vdest, err := call.Argument(1).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		width, err := call.Argument(2).ToInteger()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		height, err := call.Argument(3).ToInteger()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Convert the virtual paths to real paths
		srcfsh, rsrc, err := virtualPathToRealPath(vsrc, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}
		destfsh, rdest, err := virtualPathToRealPath(vdest, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		ext := strings.ToLower(filepath.Ext(rdest))
		if !utils.StringInArray([]string{".jpg", ".jpeg", ".png"}, ext) {
			g.raiseError(errors.New("File extension not supported. Only support .jpg and .png"))
			return otto.FalseValue()
		}

		if destfsh.FileSystemAbstraction.FileExists(rdest) {
			err := destfsh.FileSystemAbstraction.Remove(rdest)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		}

		resizeOpeningFile := rsrc
		resizeWritingFile := rdest
		var srcFile arozfs.File
		var destFile arozfs.File
		if srcfsh.RequireBuffer {
			resizeOpeningFile, _, err = g.bufferRemoteResourcesToLocal(srcfsh, u, rsrc)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			srcFile, err = os.Open(resizeOpeningFile)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		} else {
			srcFile, err = srcfsh.FileSystemAbstraction.Open(resizeOpeningFile)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		}
		defer srcFile.Close()

		if destfsh.RequireBuffer {
			resizeWritingFile, _, err = g.bufferRemoteResourcesToLocal(destfsh, u, rdest)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			destFile, err = os.OpenFile(resizeWritingFile, os.O_CREATE|os.O_WRONLY, 0775)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		} else {
			destFile, err = destfsh.FileSystemAbstraction.OpenFile(resizeWritingFile, os.O_CREATE|os.O_WRONLY, 0775)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		}
		defer destFile.Close()

		//Resize the image
		//src, err := imaging.Open(resizeOpeningFile)
		src, err := imaging.Decode(srcFile)
		if err != nil {
			//Opening failed
			g.raiseError(err)
			return otto.FalseValue()
		}
		src = imaging.Resize(src, int(width), int(height), imaging.Lanczos)
		//err = imaging.Save(src, resizeWritingFile)
		f, err := imaging.FormatFromFilename(resizeWritingFile)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		err = imaging.Encode(destFile, src, f)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		if destfsh.RequireBuffer {
			c, _ := os.ReadFile(resizeWritingFile)
			destfsh.FileSystemAbstraction.WriteFile(rdest, c, 0775)
		}

		return otto.TrueValue()
	})

	//Crop the given image, require (input, output, posx, posy, width, height)
	vm.Set("_imagelib_cropImage", func(call otto.FunctionCall) otto.Value {
		vsrc, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		vdest, err := call.Argument(1).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		posx, err := call.Argument(2).ToInteger()
		if err != nil {
			posx = 0
		}

		posy, err := call.Argument(3).ToInteger()
		if err != nil {
			posy = 0
		}

		width, err := call.Argument(4).ToInteger()
		if err != nil {
			g.raiseError(errors.New("Image width not defined"))
			return otto.FalseValue()
		}

		height, err := call.Argument(5).ToInteger()
		if err != nil {
			g.raiseError(errors.New("Image height not defined"))
			return otto.FalseValue()
		}

		//Convert the virtual paths to realpaths

		srcFsh, rsrc, err := virtualPathToRealPath(vsrc, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}
		srcFshAbs := srcFsh.FileSystemAbstraction
		destFsh, rdest, err := virtualPathToRealPath(vdest, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Try to read the source image
		imageBytes, err := srcFshAbs.ReadFile(rsrc)
		if err != nil {
			fmt.Println(err)
			g.raiseError(err)
			return otto.FalseValue()
		}

		img, _, err := image.Decode(bytes.NewReader(imageBytes))
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Crop the image
		croppedImg, _ := cutter.Crop(img, cutter.Config{
			Width:  int(width),
			Height: int(height),
			Anchor: image.Point{int(posx), int(posy)},
			Mode:   cutter.TopLeft,
		})

		//Create the output file
		var out arozfs.File
		destWritePath := ""
		if destFsh.RequireBuffer {
			destWritePath, _ = g.getUserSpecificTempFilePath(u, rdest)

			//Create the new image in buffer file
			out, err = os.Create(destWritePath)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
			defer out.Close()

		} else {
			//Create the target file via FSA
			out, err = destFsh.FileSystemAbstraction.Create(rdest)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
			defer out.Close()
		}

		if strings.ToLower(filepath.Ext(rdest)) == ".png" {
			png.Encode(out, croppedImg)
		} else if strings.ToLower(filepath.Ext(rdest)) == ".jpg" {
			jpeg.Encode(out, croppedImg, nil)
		} else {
			g.raiseError(errors.New("Not supported format: Only support jpg or png"))
			return otto.FalseValue()
		}
		out.Close()

		if destFsh.RequireBuffer {
			c, _ := os.ReadFile(destWritePath)
			err := destFsh.FileSystemAbstraction.WriteFile(rdest, c, 0775)
			if err != nil {
				fmt.Println(">", err.Error())
			}
		}

		return otto.TrueValue()
	})

	//Get the given file's thumbnail in base64
	vm.Set("_imagelib_loadThumbString", func(call otto.FunctionCall) otto.Value {
		vsrc, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		fsh, err := u.GetFileSystemHandlerFromVirtualPath(vsrc)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}
		rpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(vsrc, u.Username)

		//Get the files' thumb base64 string
		base64String, err := g.Option.FileSystemRender.LoadCache(fsh, rpath, false)
		if err != nil {
			return otto.FalseValue()
		} else {
			value, _ := vm.ToValue(base64String)
			return value
		}
	})

	vm.Set("_imagelib_classify", func(call otto.FunctionCall) otto.Value {
		vsrc, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		classifier, err := call.Argument(1).ToString()
		if err != nil {
			classifier = "default"
		}

		if classifier == "" || classifier == "undefined" {
			classifier = "default"
		}

		//Convert the vsrc to real path
		fsh, rsrc, err := virtualPathToRealPath(vsrc, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		analysisSrc := rsrc
		var closerFunc func()
		if fsh.RequireBuffer {
			analysisSrc, closerFunc, err = g.bufferRemoteResourcesToLocal(fsh, u, rsrc)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
			defer closerFunc()
		}

		if classifier == "default" || classifier == "darknet19" {
			//Use darknet19 for classification
			r, err := neuralnet.AnalysisPhotoDarknet19(analysisSrc)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			result, err := vm.ToValue(r)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			return result

		} else if classifier == "yolo3" {
			//Use yolo3 for classification, return positions of object as well
			r, err := neuralnet.AnalysisPhotoYOLO3(analysisSrc)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			result, err := vm.ToValue(r)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}

			return result

		} else {
			//Unsupported classifier
			log.Println("[AGI] Unsupported image classifier name: " + classifier)
			g.raiseError(err)
			return otto.FalseValue()
		}

	})

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var imagelib = {};
		imagelib.getImageDimension = _imagelib_getImageDimension;
		imagelib.resizeImage = _imagelib_resizeImage;
		imagelib.cropImage = _imagelib_cropImage;
		imagelib.loadThumbString = _imagelib_loadThumbString;
		imagelib.classify = _imagelib_classify;
	`)
}
