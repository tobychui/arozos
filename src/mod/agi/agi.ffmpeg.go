package agi

import (
	"errors"
	"log"
	"os"
	"path/filepath"

	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/agi/static/ffmpegutil"
	"imuslab.com/arozos/mod/utils"
)

/*
	AJGI FFmpeg adaptor Library

	This is a library for allow the use of ffmpeg via the arozos virtualized layer
	without the danger of directly accessing the bash / shell interface.

	Author: tobychui

*/

func (g *Gateway) FFmpegLibRegister() {
	err := g.RegisterLib("ffmpeg", g.injectFFmpegFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectFFmpegFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh
	//scriptPath := payload.ScriptPath
	//w := payload.Writer
	//r := payload.Request
	vm.Set("_ffmpeg_conv", func(call otto.FunctionCall) otto.Value {
		//Get the input and output filepath
		vinput, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		voutput, err := call.Argument(1).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		if voutput == "" {
			//Output filename not provided. Not sure what format to convert
			g.RaiseError(err)
			return otto.FalseValue()
		}

		compression, err := call.Argument(2).ToInteger()
		if err != nil {
			//Do not use compression
			compression = 0
		}

		//Rewrite the vpath if it is relative
		vinput = static.RelativeVpathRewrite(scriptFsh, vinput, vm, u)
		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)

		//Translate the virtual path to realpath for the input file
		fsh, rinput, err := static.VirtualPathToRealPath(vinput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Translate the virtual path to realpath for the output file
		fsh, routput, err := static.VirtualPathToRealPath(voutput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//Buffer the file to tmp
		//Note that even for local disk, it still need to be buffered to make sure
		//permission is in-scope as well as to avoid locking a file by child-process
		bufferedFilepath, err := fsh.BufferRemoteToLocal(rinput)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		//fmt.Println(rinput, routput, bufferedFilepath)

		//Convert it to target format using ffmpeg
		outputTmpFilename := uuid.NewV4().String() + filepath.Ext(routput)
		outputBufferPath := filepath.Join(filepath.Dir(bufferedFilepath), outputTmpFilename)
		err = ffmpegutil.FFmpeg_conv(bufferedFilepath, outputBufferPath, int(compression))
		if err != nil {
			//FFmpeg conversion failed
			g.RaiseError(err)

			//Delete the buffered file
			os.Remove(bufferedFilepath)
			return otto.FalseValue()
		}

		if !utils.FileExists(outputBufferPath) {
			//Fallback check, to see if the output file actually exists
			g.RaiseError(errors.New("output file not found. Assume ffmpeg conversion failed"))
			//Delete the buffered file
			os.Remove(bufferedFilepath)
			return otto.FalseValue()
		}

		//Conversion completed

		//Delete the buffered file
		os.Remove(bufferedFilepath)

		//Upload the converted file to target disk
		src, err := os.OpenFile(outputBufferPath, os.O_RDONLY, 0755)
		if err != nil {
			g.RaiseError(err)
			//Delete the output buffer if failed
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		defer src.Close()

		err = fsh.FileSystemAbstraction.WriteStream(routput, src, 0775)
		if err != nil {
			g.RaiseError(err)
			//Delete the output buffer if failed
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}

		//Upload completed. Remove the remaining buffer file
		os.Remove(outputBufferPath)
		return otto.TrueValue()
	})

	vm.Run(`
		var ffmpeg = {};
		ffmpeg.convert = _ffmpeg_conv;
	`)
}
