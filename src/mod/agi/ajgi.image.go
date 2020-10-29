package agi

import (
	"github.com/robertkrimen/otto"
	"github.com/disintegration/imaging"
	"image"
	"net/http"
	_ "image/jpeg"
	_ "image/png"
	"path/filepath"
	"strings"
	"os"
	"errors"
	"log"
)

/*
	AJGI Image Processing Library

	This is a library for handling image related functionalities in agi scripts.

*/

func (g *Gateway)ImageLibRegister(){
	err := g.RegisterLib("imagelib", g.injectImageLibFunctions)	
	if (err != nil){
		log.Fatal(err)
	}
}

func (g *Gateway)injectImageLibFunctions(vm *otto.Otto, w http.ResponseWriter, r *http.Request){
	u, err := g.Option.UserHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		panic(err.Error())
	}

	//Get image dimension, requires filepath (virtual)
	vm.Set("_imagelib_getImageDimension", func(call otto.FunctionCall) otto.Value {
		imageFileVpath, err := call.Argument(0).ToString()
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}

		imagePath, err := virtualPathToRealPath(imageFileVpath,u);	
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}

		if !fileExists(imagePath){
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
		file.Close();
		rawResults := []int{image.Width, image.Height}
		result, _ := vm.ToValue(rawResults)
		return result
	})

	//Resize image, require (filepath, outputpath, width, height)
	vm.Set("_imagelib_resizeImage", func(call otto.FunctionCall) otto.Value {
		vsrc, err := call.Argument(0).ToString()
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}

		vdest, err := call.Argument(1).ToString()
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}

		width, err := call.Argument(2).ToInteger()
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}

		height, err := call.Argument(3).ToInteger()
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Convert the virtual paths to real paths
		rsrc, err := virtualPathToRealPath(vsrc,u);
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}
		rdest, err := virtualPathToRealPath(vdest,u);
		if (err != nil){
			g.raiseError(err)
			return otto.FalseValue()
		}

		ext := strings.ToLower(filepath.Ext(rdest))
		if (!inArray([]string{".jpg", ".jpeg", ".png"}, ext)){
			g.raiseError(errors.New("File extension not supported. Only support .jpg and .png"))
			return otto.FalseValue()
		}

		if fileExists(rdest){
			err := os.Remove(rdest)
			if (err != nil){
				g.raiseError(err)
				return otto.FalseValue()
			}
		}

		//Resize the image
		src, err := imaging.Open(rsrc)
		if (err != nil){
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

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var imagelib = {};
		imagelib.getImageDimension = _imagelib_getImageDimension;
		imagelib.resizeImage = _imagelib_resizeImage;
	`);
}

