package agi

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	_ "image/jpeg"
	"image/png"
	_ "image/png"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/oliamb/cutter"
	"github.com/robertkrimen/otto"

	"imuslab.com/arozos/mod/neuralnet"
	user "imuslab.com/arozos/mod/user"
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

func (g *Gateway) injectImageLibFunctions(vm *otto.Otto, u *user.User) {

	//Get image dimension, requires filepath (virtual)
	vm.Set("_imagelib_getImageDimension", func(call otto.FunctionCall) otto.Value {
		imageFileVpath, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		imagePath, err := virtualPathToRealPath(imageFileVpath, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		if !fileExists(imagePath) {
			g.raiseError(errors.New("File not exists! Given " + imagePath))
			return otto.FalseValue()
		}

		file, err := os.Open(imagePath)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
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
		rsrc, err := virtualPathToRealPath(vsrc, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}
		rdest, err := virtualPathToRealPath(vdest, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		ext := strings.ToLower(filepath.Ext(rdest))
		if !inArray([]string{".jpg", ".jpeg", ".png"}, ext) {
			g.raiseError(errors.New("File extension not supported. Only support .jpg and .png"))
			return otto.FalseValue()
		}

		if fileExists(rdest) {
			err := os.Remove(rdest)
			if err != nil {
				g.raiseError(err)
				return otto.FalseValue()
			}
		}

		//Resize the image
		src, err := imaging.Open(rsrc)
		if err != nil {
			//Opening failed
			g.raiseError(err)
			return otto.FalseValue()
		}
		src = imaging.Resize(src, int(width), int(height), imaging.Lanczos)
		err = imaging.Save(src, rdest)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
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
		rsrc, err := virtualPathToRealPath(vsrc, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}
		rdest, err := virtualPathToRealPath(vdest, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Try to read the source image
		imageBytes, err := ioutil.ReadFile(rsrc)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		img, _, err := image.Decode(bytes.NewReader(imageBytes))
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Crop the image
		croppedImg, err := cutter.Crop(img, cutter.Config{
			Width:  int(width),
			Height: int(height),
			Anchor: image.Point{int(posx), int(posy)},
			Mode:   cutter.TopLeft,
		})

		//Create the new image
		out, err := os.Create(rdest)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
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

		return otto.TrueValue()
	})

	//Get the given file's thumbnail in base64
	vm.Set("_imagelib_loadThumbString", func(call otto.FunctionCall) otto.Value {
		vsrc, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Convert the vsrc to real path
		rsrc, err := virtualPathToRealPath(vsrc, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Get the files' thumb base64 string
		base64String, err := g.Option.FileSystemRender.LoadCache(rsrc, false)
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
		rsrc, err := virtualPathToRealPath(vsrc, u)
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		if classifier == "default" || classifier == "darknet19" {
			//Use darknet19 for classification
			r, err := neuralnet.AnalysisPhotoDarknet19(rsrc)
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
			r, err := neuralnet.AnalysisPhotoYOLO3(rsrc)
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
