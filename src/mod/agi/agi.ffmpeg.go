package agi

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
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

/*
	FFmepg functions
*/

func ffmpeg_conv(input string, output string, compression int) error {
	var cmd *exec.Cmd

	switch {
	case isVideo(input) && isVideo(output):
		// Video to video with resolution compression
		cmd = exec.Command("ffmpeg", "-i", input, "-vf", fmt.Sprintf("scale=-1:%d", compression), output)

	case (isAudio(input) || isVideo(input)) && isAudio(output):
		// Audio or video to audio with bitrate compression
		cmd = exec.Command("ffmpeg", "-i", input, "-b:a", fmt.Sprintf("%dk", compression), output)

	case isImage(output):
		// Resize image with width compression
		cmd = exec.Command("ffmpeg", "-i", input, "-vf", fmt.Sprintf("scale=%d:-1", compression), output)

	default:
		// Handle other cases or leave it for the user to implement
		return fmt.Errorf("unsupported conversion: %s to %s", input, output)
	}

	// Set the output of the command to os.Stdout so you can see it in your console
	cmd.Stdout = os.Stdout

	// Set the output of the command to os.Stderr so you can see any errors
	cmd.Stderr = os.Stderr

	// Run the command
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("error running ffmpeg command: %v", err)
	}

	return nil
}

// Helper functions to check file types
func isVideo(filename string) bool {
	videoFormats := []string{
		".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm",
	}
	return utils.StringInArray(videoFormats, filepath.Ext(filename))
}

func isAudio(filename string) bool {
	audioFormats := []string{
		".mp3", ".wav", ".aac", ".ogg", ".flac",
	}
	return utils.StringInArray(audioFormats, filepath.Ext(filename))
}

func isImage(filename string) bool {
	imageFormats := []string{
		".jpg", ".png", ".gif", ".bmp", ".tiff", ".webp",
	}
	return utils.StringInArray(imageFormats, filepath.Ext(filename))
}

func main() {
	// Example usage
	err := ffmpeg_conv("input.mp4", "output.mp4", 720)
	if err != nil {
		fmt.Println("Error:", err)
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

		fmt.Println(rinput, routput, bufferedFilepath)

		return otto.TrueValue()
	})
}
