package agi

/*
	AJGI Video Editor Library

	Server-side rendering for timeline video editors such as Cine Studio.
	The render logic (timeline spec, filter graph, proxies, hardware encoder
	and the background job runner) lives in mod/videoeditor; this file only
	resolves virtual paths with the calling user's permissions and hands the
	work over.

	Usage (from an AGI script):
		requirelib("videoeditor");
		videoeditor.hwEncoder();                                   // "" = software only
		videoeditor.renderTimeline(specJSON, output, progressFile[, options]);
		videoeditor.makeProxy(input, output, kind, height, progressFile);
		videoeditor.isRunning(progressFile);
		videoeditor.cancel(progressFile);

	Renders and proxies are background jobs: the call returns true at once
	and the script follows the job through its progress file, whose "stage"
	goes queued -> running -> uploading -> done (or failed, with "error").
	"completed" turns true only once the output is in its final place.

	Author: tobychui
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
	"imuslab.com/arozos/mod/videoeditor"
)

// videoEditorJobs caps the renders and proxies encoding at once so a user
// importing a folder of footage cannot bring a small host to its knees.
var videoEditorJobs = videoeditor.NewRunner(2)

func (g *Gateway) VideoEditorLibRegister() {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		logger.PrintAndLog("Agi", "ffmpeg not found in PATH, videoeditor library disabled", nil)
		return
	}
	if err := g.RegisterLib("videoeditor", g.injectVideoEditorFunctions); err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
	}
}

// renderOptions are the optional settings of videoeditor.renderTimeline.
// They hand the server everything a render needs once it is running, so
// nothing depends on the caller (a browser tab, say) still being around.
type renderOptions struct {
	Cleanup string `json:"cleanup"` // virtual folder to delete once the job has ended
	Notify  bool   `json:"notify"`  // tell the user through the notification system when it has ended
}

// parseRenderOptions reads the options argument: undefined, a JSON string or
// a plain object.
func parseRenderOptions(v otto.Value) (renderOptions, error) {
	var opts renderOptions
	if v.IsUndefined() || v.IsNull() {
		return opts, nil
	}
	var raw []byte
	if v.IsString() {
		str, _ := v.ToString()
		if strings.TrimSpace(str) == "" {
			return opts, nil
		}
		raw = []byte(str)
	} else {
		exported, err := v.Export()
		if err != nil {
			return opts, fmt.Errorf("invalid render options: %v", err)
		}
		if raw, err = json.Marshal(exported); err != nil {
			return opts, fmt.Errorf("invalid render options: %v", err)
		}
	}
	if err := json.Unmarshal(raw, &opts); err != nil {
		return opts, fmt.Errorf("invalid render options: %v", err)
	}
	return opts, nil
}

// checkScratchDir refuses folders a render must never delete on its own: the
// root of a file system, or a folder that holds the output the job writes.
func checkScratchDir(dir string, output string) error {
	clean := strings.TrimRight(strings.TrimSpace(dir), "/")
	colon := strings.Index(clean, ":")
	if colon < 0 || strings.Trim(clean[colon+1:], "/") == "" {
		return errors.New("cleanup must be a folder inside a file system, not its root: " + dir)
	}
	if output == clean || strings.HasPrefix(output, clean+"/") {
		return errors.New("cleanup folder " + dir + " contains the output file")
	}
	return nil
}

// removeScratchDir deletes a job's scratch folder with the user's own rights,
// releasing the quota of the files in it the way a normal delete does.
func removeScratchDir(u *user.User, vdir string) error {
	if !u.CanWrite(vdir) {
		return errors.New("path access denied: " + vdir)
	}
	fsh, rpath, err := static.VirtualPathToRealPath(vdir, u)
	if err != nil {
		return err
	}
	abs := fsh.FileSystemAbstraction
	if !abs.FileExists(rpath) {
		return nil
	}
	if entries, err := abs.ReadDir(rpath); err == nil {
		for _, entry := range entries {
			child := strings.TrimRight(vdir, "/") + "/" + entry.Name()
			if u.IsOwnerOfFile(fsh, child) {
				u.RemoveOwnershipFromFile(fsh, child)
			}
		}
	}
	return abs.RemoveAll(rpath)
}

// notifyRenderEnded tells a user, through their own notification preferences,
// that a background render has ended. A render the user cancelled is not
// worth a message.
func (g *Gateway) notifyRenderEnded(sender string, username string, output string, jobErr error) {
	if errors.Is(jobErr, videoeditor.ErrCancelled) {
		return
	}
	name := output[strings.LastIndex(output, "/")+1:]
	folder := strings.TrimRight(output[:len(output)-len(name)], "/")
	title := "Export finished: " + name
	message := "Saved to " + folder
	if jobErr != nil {
		title = "Export failed: " + name
		message = jobErr.Error()
	}
	if err := g.buildAndSendNotification(sender, []string{username}, title, message, "medium"); err != nil {
		logger.PrintAndLog("Agi", "[AGI] could not send the render notification to "+username, err)
	}
}

// videoEditorJob is a render or proxy described in virtual paths, already
// resolved against the calling user.
type videoEditorJob struct {
	title        string
	user         *user.User
	inputs       []string // virtual paths
	output       string   // virtual path
	progressFile string   // real path
	build        func(localInputs []string) (args []string, durationMs int64, err error)
	onFinish     func(err error)
}

// checkVideoEditorJob validates a job synchronously, so the script hears
// about a missing file or a bad path before anything is queued.
func checkVideoEditorJob(job *videoEditorJob) error {
	if job.user == nil {
		return errors.New("video editor jobs need a user scope")
	}
	if job.progressFile == "" {
		return errors.New("progress file not provided")
	}
	if job.output == "" || job.output == "undefined" {
		return errors.New("output filename not provided")
	}
	if !job.user.CanWrite(job.output) {
		return errors.New("path access denied: " + job.output)
	}
	for _, vpath := range job.inputs {
		if !job.user.CanRead(vpath) {
			return errors.New("path access denied: " + vpath)
		}
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, job.user)
		if err != nil {
			return fmt.Errorf("%s: %v", vpath, err)
		}
		if !fsh.FileSystemAbstraction.FileExists(rpath) {
			return fmt.Errorf("%s: file not found", vpath)
		}
	}
	if _, _, err := static.VirtualPathToRealPath(job.output, job.user); err != nil {
		return fmt.Errorf("output %s: %v", job.output, err)
	}
	return nil
}

// startVideoEditorJob checks a job and hands it to the background runner.
// Inputs on remote file systems are buffered to local disk once the job has
// an encoder slot, and the result is written back through the file system
// abstraction so remote targets work too.
func startVideoEditorJob(job *videoEditorJob) error {
	if err := checkVideoEditorJob(job); err != nil {
		return err
	}
	var buffered []string
	return videoEditorJobs.Start(&videoeditor.Job{
		ProgressFile: job.progressFile,
		Prepare: func() (*videoeditor.Command, error) {
			local := make([]string, 0, len(job.inputs))
			for _, vpath := range job.inputs {
				fsh, rpath, err := static.VirtualPathToRealPath(vpath, job.user)
				if err != nil {
					return nil, err
				}
				if utils.FileExists(rpath) {
					abs, err := filepath.Abs(rpath)
					if err != nil {
						return nil, err
					}
					local = append(local, abs)
					continue
				}
				tmp, err := fsh.BufferRemoteToLocal(rpath)
				if err != nil {
					return nil, fmt.Errorf("unable to buffer %s: %v", vpath, err)
				}
				buffered = append(buffered, tmp)
				local = append(local, tmp)
			}
			args, durationMs, err := job.build(local)
			if err != nil {
				return nil, err
			}
			scratch, err := videoEditorScratchFile(job.user, job.output)
			if err != nil {
				return nil, err
			}
			return &videoeditor.Command{Args: args, Output: scratch, DurationMs: durationMs}, nil
		},
		Deliver: func(localOutput string) error {
			fsh, routput, err := static.VirtualPathToRealPath(job.output, job.user)
			if err != nil {
				return err
			}
			src, err := os.Open(localOutput)
			if err != nil {
				return err
			}
			defer src.Close()
			if err := fsh.FileSystemAbstraction.WriteStream(routput, src, 0775); err != nil {
				return fmt.Errorf("unable to write %s: %v", job.output, err)
			}
			return nil
		},
		Finish: func(err error) {
			for _, f := range buffered {
				os.Remove(f)
			}
			if err != nil && !errors.Is(err, videoeditor.ErrCancelled) {
				logger.PrintAndLog("Agi", "[AGI] video editor "+job.title+" failed for "+job.user.Username, err)
			}
			if job.onFinish != nil {
				job.onFinish(err)
			}
		},
	})
}

// videoEditorScratchFile picks the local file ffmpeg encodes into before the
// result is moved to its final place.
func videoEditorScratchFile(u *user.User, voutput string) (string, error) {
	fsh, routput, err := static.VirtualPathToRealPath(voutput, u)
	if err != nil {
		return "", err
	}
	dir := fsh.RuntimePersistenceConfig.LocalBufferPath
	if dir == "" {
		dir = os.TempDir()
	}
	if err := os.MkdirAll(dir, 0775); err != nil {
		return "", err
	}
	return filepath.Join(dir, "videoeditor_"+uuid.NewV4().String()+filepath.Ext(routput)), nil
}

// resolveVideoEditorProgressFile turns the script's progress file vpath into
// the real path that identifies the job.
func resolveVideoEditorProgressFile(scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, u *user.User, vprogress string) (string, error) {
	if vprogress == "" || vprogress == "undefined" {
		return "", errors.New("progress file not provided")
	}
	vprogress = static.RelativeVpathRewrite(scriptFsh, vprogress, vm, u)
	if !u.CanWrite(vprogress) {
		return "", errors.New("path access denied: " + vprogress)
	}
	_, rprogress, err := static.VirtualPathToRealPath(vprogress, u)
	if err != nil {
		return "", err
	}
	return rprogress, nil
}

// videoEditorEncoder picks the encoder for a job: the hardware profile when
// asked for and available, libx264 otherwise.
func videoEditorEncoder(wantHardware bool) *videoeditor.Encoder {
	if !wantHardware {
		return nil
	}
	return videoeditor.HardwareEncoder()
}

func (g *Gateway) injectVideoEditorFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	//Notifications are sent in the name of the script's module, as in the
	//notification library
	senderLabel := "AGI Script"
	if payload.ScriptPath != "" {
		senderLabel = static.GetScriptRoot(payload.ScriptPath, "./web/")
	}

	// _videoeditor_hw_encoder() -> name of the hardware encoder, "" for software only
	vm.Set("_videoeditor_hw_encoder", func(call otto.FunctionCall) otto.Value {
		name := ""
		if enc := videoeditor.HardwareEncoder(); enc != nil {
			name = enc.Name
		}
		v, _ := otto.ToValue(name)
		return v
	})

	// _videoeditor_render_timeline(specJSON, output, progressFile[, options])
	// Every "src" in the spec is a virtual path readable by the calling user.
	vm.Set("_videoeditor_render_timeline", func(call otto.FunctionCall) otto.Value {
		specJSON, err := call.Argument(0).ToString()
		if err != nil || specJSON == "" || specJSON == "undefined" {
			g.RaiseError(errors.New("render spec not provided"))
			return otto.FalseValue()
		}
		voutput, err := call.Argument(1).ToString()
		if err != nil || voutput == "" || voutput == "undefined" {
			g.RaiseError(errors.New("output filename not provided"))
			return otto.FalseValue()
		}
		vprogress, _ := call.Argument(2).ToString()
		if u == nil {
			g.RaiseError(errors.New("renderTimeline needs a user scope"))
			return otto.FalseValue()
		}
		opts, err := parseRenderOptions(call.Argument(3))
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		var project videoeditor.Project
		if err := json.Unmarshal([]byte(specJSON), &project); err != nil {
			g.RaiseError(fmt.Errorf("invalid render spec: %v", err))
			return otto.FalseValue()
		}
		if err := project.Validate(); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		if strings.ToLower(strings.TrimPrefix(filepath.Ext(voutput), ".")) != project.Format {
			g.RaiseError(fmt.Errorf("output file must end in .%s", project.Format))
			return otto.FalseValue()
		}

		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)
		if opts.Cleanup != "" {
			opts.Cleanup = strings.TrimRight(static.RelativeVpathRewrite(scriptFsh, opts.Cleanup, vm, u), "/")
			if err := checkScratchDir(opts.Cleanup, voutput); err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			if !u.CanWrite(opts.Cleanup) {
				g.RaiseError(errors.New("path access denied: " + opts.Cleanup))
				return otto.FalseValue()
			}
		}
		rprogress, err := resolveVideoEditorProgressFile(scriptFsh, vm, u, vprogress)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Distinct sources in first-seen order; the local path of each is
		// put back into the spec before the graph is built
		var inputs []string
		index := map[string]int{}
		addSource := func(src *string) {
			v := static.RelativeVpathRewrite(scriptFsh, *src, vm, u)
			*src = v
			if _, ok := index[v]; !ok {
				index[v] = len(inputs)
				inputs = append(inputs, v)
			}
		}
		for i := range project.Layers {
			if project.Layers[i].Src != "" {
				addSource(&project.Layers[i].Src)
			}
		}
		for i := range project.Audio {
			addSource(&project.Audio[i].Src)
		}

		enc := videoEditorEncoder(project.Hardware)
		job := &videoEditorJob{
			title:        "timeline render",
			user:         u,
			inputs:       inputs,
			output:       voutput,
			progressFile: rprogress,
			build: func(local []string) ([]string, int64, error) {
				spec := project
				spec.Layers = append([]videoeditor.Layer{}, project.Layers...)
				spec.Audio = append([]videoeditor.AudioClip{}, project.Audio...)
				for i := range spec.Layers {
					if spec.Layers[i].Src != "" {
						spec.Layers[i].Src = local[index[spec.Layers[i].Src]]
					}
				}
				for i := range spec.Audio {
					spec.Audio[i].Src = local[index[spec.Audio[i].Src]]
				}
				spec.Audio = videoeditor.DropSilentAudio(spec.Audio, videoeditor.HasAudioStream)
				res, err := videoeditor.BuildArgs(&spec, enc)
				if err != nil {
					return nil, 0, err
				}
				return res.Args, res.DurationMs, nil
			},
			onFinish: func(jobErr error) {
				if opts.Cleanup != "" {
					if err := removeScratchDir(u, opts.Cleanup); err != nil {
						logger.PrintAndLog("Agi", "[AGI] could not remove render scratch folder "+opts.Cleanup, err)
					}
				}
				if opts.Notify {
					g.notifyRenderEnded(senderLabel, u.Username, voutput, jobErr)
				}
			},
		}
		if err := startVideoEditorJob(job); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	// _videoeditor_make_proxy(input, output, kind, height, progressFile)
	// Converts footage into a browser-playable proxy: kind is "video"
	// (H.264 / AAC MP4, at most height pixels tall, 0 = source size),
	// "audio" (AAC M4A) or "image" (PNG).
	vm.Set("_videoeditor_make_proxy", func(call otto.FunctionCall) otto.Value {
		vinput, err := call.Argument(0).ToString()
		if err != nil || vinput == "" || vinput == "undefined" {
			g.RaiseError(errors.New("input filename not provided"))
			return otto.FalseValue()
		}
		voutput, err := call.Argument(1).ToString()
		if err != nil || voutput == "" || voutput == "undefined" {
			g.RaiseError(errors.New("output filename not provided"))
			return otto.FalseValue()
		}
		kind, _ := call.Argument(2).ToString()
		height, err := call.Argument(3).ToInteger()
		if err != nil || call.Argument(3).IsUndefined() || height < 0 {
			height = 0
		}
		if height > 8192 {
			g.RaiseError(errors.New("proxy height out of range"))
			return otto.FalseValue()
		}
		vprogress, _ := call.Argument(4).ToString()
		if u == nil {
			g.RaiseError(errors.New("makeProxy needs a user scope"))
			return otto.FalseValue()
		}
		wantExt, ok := videoeditor.ProxyExtension[kind]
		if !ok {
			g.RaiseError(fmt.Errorf("unsupported proxy kind %q", kind))
			return otto.FalseValue()
		}
		if !strings.EqualFold(filepath.Ext(voutput), wantExt) {
			g.RaiseError(fmt.Errorf("%s proxies must end in %s", kind, wantExt))
			return otto.FalseValue()
		}
		rprogress, err := resolveVideoEditorProgressFile(scriptFsh, vm, u, vprogress)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		vinput = static.RelativeVpathRewrite(scriptFsh, vinput, vm, u)
		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)

		// Proxies exist for speed: take the hardware encoder when there is one
		enc := videoEditorEncoder(true)
		job := &videoEditorJob{
			title:        kind + " proxy",
			user:         u,
			inputs:       []string{vinput},
			output:       voutput,
			progressFile: rprogress,
			build: func(local []string) ([]string, int64, error) {
				args, err := videoeditor.ProxyArgs(kind, local[0], int(height), enc)
				if err != nil {
					return nil, 0, err
				}
				return args, videoeditor.MediaDurationMs(local[0]), nil
			},
		}
		if err := startVideoEditorJob(job); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	// _videoeditor_is_running(progressFile) -> true while the job is queued or encoding
	vm.Set("_videoeditor_is_running", func(call otto.FunctionCall) otto.Value {
		vprogress, _ := call.Argument(0).ToString()
		if u == nil {
			return otto.FalseValue()
		}
		rprogress, err := resolveVideoEditorProgressFile(scriptFsh, vm, u, vprogress)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		v, _ := otto.ToValue(videoEditorJobs.Running(rprogress))
		return v
	})

	// _videoeditor_cancel(progressFile) -> true when a queued or running job was stopped
	vm.Set("_videoeditor_cancel", func(call otto.FunctionCall) otto.Value {
		vprogress, _ := call.Argument(0).ToString()
		if u == nil {
			return otto.FalseValue()
		}
		rprogress, err := resolveVideoEditorProgressFile(scriptFsh, vm, u, vprogress)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		v, _ := otto.ToValue(videoEditorJobs.Cancel(rprogress))
		return v
	})

	vm.Run(`
		var videoeditor = {};
		videoeditor.hwEncoder = _videoeditor_hw_encoder;
		videoeditor.renderTimeline = _videoeditor_render_timeline;
		videoeditor.makeProxy = _videoeditor_make_proxy;
		videoeditor.isRunning = _videoeditor_is_running;
		videoeditor.cancel = _videoeditor_cancel;
	`)
}
