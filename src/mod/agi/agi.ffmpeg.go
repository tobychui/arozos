package agi

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/agi/static/ffmpegutil"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	AJGI FFmpeg adaptor Library

	This is a library for allow the use of ffmpeg via the arozos virtualized layer
	without the danger of directly accessing the bash / shell interface.

	Author: tobychui

*/

func (g *Gateway) FFmpegLibRegister() {
	_, err := exec.LookPath("ffmpeg")
	if err != nil {
		logger.PrintAndLog("Agi", "ffmpeg not found in PATH", nil)
		os.Exit(1)
	}
	err = g.RegisterLib("ffmpeg", g.injectFFmpegFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
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
			g.RaiseError(errors.New("output filename not provided"))
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

	// _ffmpeg_audio_conv(input, output, sampleRate, progressFile)
	// Converts audio (or strips audio from video).
	// sampleRate: target Hz, e.g. 44100; 0 keeps original.
	// progressFile: virtual path for the JSON progress file; omit or pass "" to disable.
	vm.Set("_ffmpeg_audio_conv", func(call otto.FunctionCall) otto.Value {
		vinput, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		voutput, err := call.Argument(1).ToString()
		if err != nil || voutput == "" || voutput == "undefined" {
			g.RaiseError(errors.New("output filename not provided"))
			return otto.FalseValue()
		}
		sampleRate, err := call.Argument(2).ToInteger()
		if err != nil || call.Argument(2).IsUndefined() {
			sampleRate = 0
		}
		vprogressFile := ""
		if !call.Argument(3).IsUndefined() {
			vprogressFile, _ = call.Argument(3).ToString()
		}

		vinput = static.RelativeVpathRewrite(scriptFsh, vinput, vm, u)
		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)

		fsh, rinput, err := static.VirtualPathToRealPath(vinput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fsh, routput, err := static.VirtualPathToRealPath(voutput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		rprogressFile := ""
		if vprogressFile != "" && vprogressFile != "undefined" {
			vprogressFile = static.RelativeVpathRewrite(scriptFsh, vprogressFile, vm, u)
			if _, rp, e := static.VirtualPathToRealPath(vprogressFile, u); e == nil {
				rprogressFile = rp
			}
		}

		bufferedFilepath, err := fsh.BufferRemoteToLocal(rinput)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		outputTmpFilename := uuid.NewV4().String() + filepath.Ext(routput)
		outputBufferPath := filepath.Join(filepath.Dir(bufferedFilepath), outputTmpFilename)

		err = ffmpegutil.FFmpeg_audio_conv(bufferedFilepath, outputBufferPath, int(sampleRate), rprogressFile)
		os.Remove(bufferedFilepath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		if !utils.FileExists(outputBufferPath) {
			g.RaiseError(errors.New("output file not found after audio conversion"))
			return otto.FalseValue()
		}

		src, err := os.OpenFile(outputBufferPath, os.O_RDONLY, 0755)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		defer src.Close()
		err = fsh.FileSystemAbstraction.WriteStream(routput, src, 0775)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		os.Remove(outputBufferPath)
		return otto.TrueValue()
	})

	// _ffmpeg_image_conv(input, output, scaleFactor, compressionRate)
	// Converts an image file with optional uniform scaling and lossy compression.
	// scaleFactor: float multiplier for both dimensions (0.5 = half size); 0 or 1.0 = no change.
	// compressionRate: 0-100; only applied to lossy formats (JPEG, WebP); ignored for PNG/BMP/GIF.
	vm.Set("_ffmpeg_image_conv", func(call otto.FunctionCall) otto.Value {
		vinput, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		voutput, err := call.Argument(1).ToString()
		if err != nil || voutput == "" || voutput == "undefined" {
			g.RaiseError(errors.New("output filename not provided"))
			return otto.FalseValue()
		}
		scaleFactor, err := call.Argument(2).ToFloat()
		if err != nil || call.Argument(2).IsUndefined() {
			scaleFactor = 0
		}
		compressionRate, err := call.Argument(3).ToInteger()
		if err != nil || call.Argument(3).IsUndefined() {
			compressionRate = 0
		}

		vinput = static.RelativeVpathRewrite(scriptFsh, vinput, vm, u)
		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)

		fsh, rinput, err := static.VirtualPathToRealPath(vinput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fsh, routput, err := static.VirtualPathToRealPath(voutput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		bufferedFilepath, err := fsh.BufferRemoteToLocal(rinput)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		outputTmpFilename := uuid.NewV4().String() + filepath.Ext(routput)
		outputBufferPath := filepath.Join(filepath.Dir(bufferedFilepath), outputTmpFilename)

		err = ffmpegutil.FFmpeg_image_conv(bufferedFilepath, outputBufferPath, scaleFactor, int(compressionRate))
		os.Remove(bufferedFilepath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		if !utils.FileExists(outputBufferPath) {
			g.RaiseError(errors.New("output file not found after image conversion"))
			return otto.FalseValue()
		}

		src, err := os.OpenFile(outputBufferPath, os.O_RDONLY, 0755)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		defer src.Close()
		err = fsh.FileSystemAbstraction.WriteStream(routput, src, 0775)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		os.Remove(outputBufferPath)
		return otto.TrueValue()
	})

	// _ffmpeg_video_conv(input, output, resolution, compressionRate, progressFile)
	// Converts a video file with optional resolution scaling and CRF compression.
	// resolution: "144p", "240p", "360p", "480p", "576p", "720p", "1080p", "1440p", "2160p", "4k", "8k"; "" keeps original.
	// compressionRate: 0-100; mapped to CRF 1-51 (0 = encoder default, 100 = most compressed).
	// progressFile: virtual path for the JSON progress file; omit or pass "" to disable.
	vm.Set("_ffmpeg_video_conv", func(call otto.FunctionCall) otto.Value {
		vinput, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		voutput, err := call.Argument(1).ToString()
		if err != nil || voutput == "" || voutput == "undefined" {
			g.RaiseError(errors.New("output filename not provided"))
			return otto.FalseValue()
		}
		resolution := ""
		if !call.Argument(2).IsUndefined() {
			resolution, _ = call.Argument(2).ToString()
			if resolution == "undefined" {
				resolution = ""
			}
		}
		compressionRate, err := call.Argument(3).ToInteger()
		if err != nil || call.Argument(3).IsUndefined() {
			compressionRate = 0
		}
		vprogressFile := ""
		if !call.Argument(4).IsUndefined() {
			vprogressFile, _ = call.Argument(4).ToString()
		}

		vinput = static.RelativeVpathRewrite(scriptFsh, vinput, vm, u)
		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)

		fsh, rinput, err := static.VirtualPathToRealPath(vinput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fsh, routput, err := static.VirtualPathToRealPath(voutput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		rprogressFile := ""
		if vprogressFile != "" && vprogressFile != "undefined" {
			vprogressFile = static.RelativeVpathRewrite(scriptFsh, vprogressFile, vm, u)
			if _, rp, e := static.VirtualPathToRealPath(vprogressFile, u); e == nil {
				rprogressFile = rp
			}
		}

		bufferedFilepath, err := fsh.BufferRemoteToLocal(rinput)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		outputTmpFilename := uuid.NewV4().String() + filepath.Ext(routput)
		outputBufferPath := filepath.Join(filepath.Dir(bufferedFilepath), outputTmpFilename)

		err = ffmpegutil.FFmpeg_video_conv(bufferedFilepath, outputBufferPath, resolution, int(compressionRate), rprogressFile)
		os.Remove(bufferedFilepath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		if !utils.FileExists(outputBufferPath) {
			g.RaiseError(errors.New("output file not found after video conversion"))
			return otto.FalseValue()
		}

		src, err := os.OpenFile(outputBufferPath, os.O_RDONLY, 0755)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		defer src.Close()
		err = fsh.FileSystemAbstraction.WriteStream(routput, src, 0775)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		os.Remove(outputBufferPath)
		return otto.TrueValue()
	})

	// _ffmpeg_conv_with_progress(input, output, progressFile)
	// Passes input directly to ffmpeg without format detection.
	// Suitable for cross-media conversions (e.g. mp4→gif) or unknown format pairs.
	// progressFile: virtual path for the JSON progress file; omit or pass "" to disable.
	vm.Set("_ffmpeg_conv_with_progress", func(call otto.FunctionCall) otto.Value {
		vinput, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		voutput, err := call.Argument(1).ToString()
		if err != nil || voutput == "" || voutput == "undefined" {
			g.RaiseError(errors.New("output filename not provided"))
			return otto.FalseValue()
		}
		vprogressFile := ""
		if !call.Argument(2).IsUndefined() {
			vprogressFile, _ = call.Argument(2).ToString()
		}

		vinput = static.RelativeVpathRewrite(scriptFsh, vinput, vm, u)
		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)

		fsh, rinput, err := static.VirtualPathToRealPath(vinput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		fsh, routput, err := static.VirtualPathToRealPath(voutput, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		rprogressFile := ""
		if vprogressFile != "" && vprogressFile != "undefined" {
			vprogressFile = static.RelativeVpathRewrite(scriptFsh, vprogressFile, vm, u)
			if _, rp, e := static.VirtualPathToRealPath(vprogressFile, u); e == nil {
				rprogressFile = rp
			}
		}

		bufferedFilepath, err := fsh.BufferRemoteToLocal(rinput)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		outputTmpFilename := uuid.NewV4().String() + filepath.Ext(routput)
		outputBufferPath := filepath.Join(filepath.Dir(bufferedFilepath), outputTmpFilename)

		err = ffmpegutil.FFmpeg_conv_with_progress(bufferedFilepath, outputBufferPath, rprogressFile)
		os.Remove(bufferedFilepath)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		if !utils.FileExists(outputBufferPath) {
			g.RaiseError(errors.New("output file not found after conversion"))
			return otto.FalseValue()
		}

		src, err := os.OpenFile(outputBufferPath, os.O_RDONLY, 0755)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		defer src.Close()
		err = fsh.FileSystemAbstraction.WriteStream(routput, src, 0775)
		if err != nil {
			g.RaiseError(err)
			os.Remove(outputBufferPath)
			return otto.FalseValue()
		}
		os.Remove(outputBufferPath)
		return otto.TrueValue()
	})

	vm.Run(`
		var ffmpeg = {};
		ffmpeg.convert = _ffmpeg_conv;
		ffmpeg.audioConvert = _ffmpeg_audio_conv;
		ffmpeg.imageConvert = _ffmpeg_image_conv;
		ffmpeg.videoConvert = _ffmpeg_video_conv;
		ffmpeg.convertWithProgress = _ffmpeg_conv_with_progress;
	`)
}
