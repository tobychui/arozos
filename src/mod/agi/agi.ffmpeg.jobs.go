package agi

/*
	AJGI FFmpeg adaptor - asynchronous jobs

	Timeline renders and proxy conversions can run far longer than the AGI
	VM's execution limit, so they are started here and left to finish in the
	background. The script gets a true/false back immediately and follows
	the job through its progress file:

	  ffmpeg.renderTimeline(specJSON, output, progressFile)
	  ffmpeg.makeProxy(input, output, kind, height, progressFile)
	  ffmpeg.hwEncoder()

	The progress file carries a "stage" (queued / running / uploading / done
	/ failed) and, when the job fails, an "error" message. "completed" only
	turns true once the result is fully written at its final location, so a
	poller can trust the output the moment it sees it. ffmpeg.cancel() works
	on these jobs like on any other conversion.

	Every path in a job is resolved with the calling user's permissions
	before the job starts; file names never enter a shell.

	Author: tobychui
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/agi/static/ffmpegutil"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/media/render"
	"imuslab.com/arozos/mod/media/transcoder"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

// maxConcurrentFFmpegJobs caps the background encoders running at once so a
// user importing a folder of footage cannot bring a small host to its knees.
// Further jobs wait in the queue with their stage reported as "queued".
const maxConcurrentFFmpegJobs = 2

var ffmpegJobSlots = make(chan struct{}, maxConcurrentFFmpegJobs)

// ffmpegJob is one background ffmpeg run: inputs and output are virtual
// paths already checked against the user, build turns the local input
// paths into the ffmpeg argument list.
type ffmpegJob struct {
	title        string
	user         *user.User
	inputs       []string // virtual paths
	output       string   // virtual path
	progressFile string   // real path
	build        func(localInputs []string) (args []string, totalDurationMs int64, err error)
	onFinish     func(err error) // optional: runs once the job has ended, whatever the outcome
}

// renderOptions are the optional settings of ffmpeg.renderTimeline. They let
// a script hand over everything a render needs once it is running, so nothing
// depends on the caller (a browser tab, say) still being around at the end.
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

// finishFFmpegJob records how a job ended and runs its finish hook.
func finishFFmpegJob(job *ffmpegJob, err error) {
	if err != nil {
		logger.PrintAndLog("Agi", "[AGI] ffmpeg "+job.title+" failed for "+job.user.Username, err)
		ffmpegutil.MarkProgressFailed(job.progressFile, err)
	}
	if job.onFinish != nil {
		job.onFinish(err)
	}
}

// renderEncoder picks the encoder for a job: the hardware profile when asked
// for and available, software otherwise.
func renderEncoder(wantHardware bool) *render.Encoder {
	if !wantHardware {
		return nil
	}
	hw := transcoder.HWEncoder()
	if hw == nil {
		return nil
	}
	return &render.Encoder{
		Codec:       hw.Codec,
		PreInput:    hw.PreInput,
		FinalFilter: hw.FinalFilter,
		Args:        hw.EncodeArgs,
	}
}

// resolveJobProgressFile turns the script's progress file vpath into a real
// path, which every job needs as its identity.
func resolveJobProgressFile(scriptFsh *filesystem.FileSystemHandler, vm *otto.Otto, u *user.User, vprogress string) (string, error) {
	if vprogress == "" || vprogress == "undefined" {
		return "", errors.New("progress file not provided")
	}
	vprogress = static.RelativeVpathRewrite(scriptFsh, vprogress, vm, u)
	_, rprogress, err := static.VirtualPathToRealPath(vprogress, u)
	if err != nil {
		return "", err
	}
	return rprogress, nil
}

// dropSilentAudio removes the audio entries whose source file has no audio
// stream. The editor lists an audio entry for every video clip, but a screen
// recording or an animation has none, and ffmpeg refuses a filter graph that
// selects a stream which is not there. hasAudio is asked once per file; a file
// it cannot judge keeps its entries.
func dropSilentAudio(clips []render.AudioClip, hasAudio func(string) (bool, error)) []render.AudioClip {
	verdict := map[string]bool{}
	kept := make([]render.AudioClip, 0, len(clips))
	for _, clip := range clips {
		ok, seen := verdict[clip.Src]
		if !seen {
			var err error
			ok, err = hasAudio(clip.Src)
			if err != nil {
				ok = true
			}
			verdict[clip.Src] = ok
		}
		if ok {
			kept = append(kept, clip)
		}
	}
	return kept
}

// notifyRenderEnded tells a user, through their own notification preferences,
// that a background render has ended. A render the user cancelled themselves
// is not worth a message.
func (g *Gateway) notifyRenderEnded(sender string, username string, output string, jobErr error, cancelled bool) {
	if cancelled {
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

// startFFmpegJob validates a job synchronously (so the script hears about a
// missing file or a bad path right away) and then runs it in the background.
func startFFmpegJob(job *ffmpegJob) error {
	if job.user == nil {
		return errors.New("ffmpeg jobs need a user scope")
	}
	if job.progressFile == "" {
		return errors.New("progress file not provided")
	}
	if job.output == "" || job.output == "undefined" {
		return errors.New("output filename not provided")
	}
	for _, vpath := range job.inputs {
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
	if ffmpegutil.ConversionIsRunning(job.progressFile) {
		return errors.New("a job with this progress file is already running")
	}

	ffmpegutil.WriteProgressStage(job.progressFile, ffmpegutil.StageQueued)
	go runFFmpegJob(job)
	return nil
}

// runFFmpegJob is the background half of startFFmpegJob.
func runFFmpegJob(job *ffmpegJob) {
	ffmpegJobSlots <- struct{}{}
	defer func() { <-ffmpegJobSlots }()

	finishFFmpegJob(job, executeFFmpegJob(job))
}

func executeFFmpegJob(job *ffmpegJob) error {
	var cleanup []string
	defer func() {
		for _, f := range cleanup {
			os.Remove(f)
		}
	}()

	// Inputs: ffmpeg reads local files only. A file that already lives on
	// local disk is read in place (the user's access was checked when the
	// job was accepted); anything on a remote file system is buffered.
	localInputs := make([]string, 0, len(job.inputs))
	for _, vpath := range job.inputs {
		fsh, rpath, err := static.VirtualPathToRealPath(vpath, job.user)
		if err != nil {
			return err
		}
		if utils.FileExists(rpath) {
			abs, err := filepath.Abs(rpath)
			if err != nil {
				return err
			}
			localInputs = append(localInputs, abs)
			continue
		}
		buffered, err := fsh.BufferRemoteToLocal(rpath)
		if err != nil {
			return fmt.Errorf("unable to buffer %s: %v", vpath, err)
		}
		cleanup = append(cleanup, buffered)
		localInputs = append(localInputs, buffered)
	}

	// Output: encode into a scratch file, then move it into place through the
	// file system abstraction so remote targets work too
	outFsh, routput, err := static.VirtualPathToRealPath(job.output, job.user)
	if err != nil {
		return err
	}
	scratchDir := outFsh.RuntimePersistenceConfig.LocalBufferPath
	if scratchDir == "" {
		scratchDir = os.TempDir()
	}
	if err := os.MkdirAll(scratchDir, 0775); err != nil {
		return err
	}
	scratch := filepath.Join(scratchDir, "ffmpegjob_"+uuid.NewV4().String()+filepath.Ext(routput))
	cleanup = append(cleanup, scratch)

	args, totalMs, err := job.build(localInputs)
	if err != nil {
		return err
	}
	if err := ffmpegutil.RunWithProgress(args, scratch, totalMs, job.progressFile); err != nil {
		return err
	}
	if !utils.FileExists(scratch) {
		return errors.New("ffmpeg produced no output")
	}

	ffmpegutil.WriteProgressStage(job.progressFile, ffmpegutil.StageUploading)
	src, err := os.Open(scratch)
	if err != nil {
		return err
	}
	defer src.Close()
	if err := outFsh.FileSystemAbstraction.WriteStream(routput, src, 0775); err != nil {
		return fmt.Errorf("unable to write %s: %v", job.output, err)
	}
	ffmpegutil.MarkProgressCompleted(job.progressFile, scratch)
	return nil
}

// injectFFmpegJobFunctions adds the asynchronous job functions to the VM.
func (g *Gateway) injectFFmpegJobFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	scriptFsh := payload.ScriptFsh

	//The notification sender label is the script's module root, as in the
	//notification library
	senderLabel := "AGI Script"
	if payload.ScriptPath != "" {
		senderLabel = static.GetScriptRoot(payload.ScriptPath, "./web/")
	}

	// _ffmpeg_hw_encoder() -> name of the hardware encoder, "" for software only
	vm.Set("_ffmpeg_hw_encoder", func(call otto.FunctionCall) otto.Value {
		hw := transcoder.HWEncoder()
		if hw == nil {
			v, _ := otto.ToValue("")
			return v
		}
		v, _ := otto.ToValue(hw.Name)
		return v
	})

	// _ffmpeg_render_timeline(specJSON, output, progressFile)
	// Renders a timeline described by a render.Project JSON document. Every
	// "src" in the spec is a virtual path readable by the calling user.
	vm.Set("_ffmpeg_render_timeline", func(call otto.FunctionCall) otto.Value {
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

		var project render.Project
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

		rprogress, err := resolveJobProgressFile(scriptFsh, vm, u, vprogress)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		// Distinct sources, in first-seen order; the local path of each is
		// substituted back into the spec before the graph is built
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
			addSource(&project.Layers[i].Src)
		}
		for i := range project.Audio {
			addSource(&project.Audio[i].Src)
		}

		enc := renderEncoder(project.Hardware)
		job := &ffmpegJob{
			title:        "timeline render",
			user:         u,
			inputs:       inputs,
			output:       voutput,
			progressFile: rprogress,
			onFinish: func(jobErr error) {
				if opts.Cleanup != "" {
					if err := removeScratchDir(u, opts.Cleanup); err != nil {
						logger.PrintAndLog("Agi", "[AGI] could not remove render scratch folder "+opts.Cleanup, err)
					}
				}
				if opts.Notify {
					g.notifyRenderEnded(senderLabel, u.Username, voutput, jobErr, ffmpegutil.WasCancelled(rprogress))
				}
			},
			build: func(local []string) ([]string, int64, error) {
				spec := project
				spec.Layers = append([]render.Layer{}, project.Layers...)
				spec.Audio = append([]render.AudioClip{}, project.Audio...)
				for i := range spec.Layers {
					spec.Layers[i].Src = local[index[spec.Layers[i].Src]]
				}
				for i := range spec.Audio {
					spec.Audio[i].Src = local[index[spec.Audio[i].Src]]
				}
				spec.Audio = dropSilentAudio(spec.Audio, ffmpegutil.HasAudioStream)
				res, err := render.BuildArgs(&spec, enc)
				if err != nil {
					return nil, 0, err
				}
				return res.Args, res.DurationMs, nil
			},
		}
		if err := startFFmpegJob(job); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	// _ffmpeg_make_proxy(input, output, kind, height, progressFile)
	// Converts footage into a browser-playable proxy: kind is "video"
	// (H.264 / AAC MP4, at most height pixels tall, 0 = source size),
	// "audio" (AAC M4A) or "image" (PNG).
	vm.Set("_ffmpeg_make_proxy", func(call otto.FunctionCall) otto.Value {
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
		wantExt, ok := render.ProxyExtension[kind]
		if !ok {
			g.RaiseError(fmt.Errorf("unsupported proxy kind %q", kind))
			return otto.FalseValue()
		}
		if !strings.EqualFold(filepath.Ext(voutput), wantExt) {
			g.RaiseError(fmt.Errorf("%s proxies must end in %s", kind, wantExt))
			return otto.FalseValue()
		}

		rprogress, err := resolveJobProgressFile(scriptFsh, vm, u, vprogress)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		vinput = static.RelativeVpathRewrite(scriptFsh, vinput, vm, u)
		voutput = static.RelativeVpathRewrite(scriptFsh, voutput, vm, u)

		// Proxies exist for speed: take the hardware encoder when there is one
		enc := renderEncoder(true)
		job := &ffmpegJob{
			title:        kind + " proxy",
			user:         u,
			inputs:       []string{vinput},
			output:       voutput,
			progressFile: rprogress,
			build: func(local []string) ([]string, int64, error) {
				args, err := render.ProxyArgs(kind, local[0], int(height), enc)
				if err != nil {
					return nil, 0, err
				}
				return args, ffmpegutil.MediaDurationMs(local[0]), nil
			},
		}
		if err := startFFmpegJob(job); err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})
}
