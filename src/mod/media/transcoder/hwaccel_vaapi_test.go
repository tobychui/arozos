package transcoder

import (
	"strings"
	"testing"
)

// TestVAAPIScaleFilter verifies the software scale filter is carried over to
// scale_vaapi with its expressions intact, and that the NV12 conversion is
// always present (it is what turns 10-bit frames into 8-bit ones).
func TestVAAPIScaleFilter(t *testing.T) {
	scale720, err := resolutionScaleFilter(TranscodeResolution_720p)
	if err != nil {
		t.Fatalf("resolutionScaleFilter(720p) returned error: %v", err)
	}
	cases := []struct {
		name  string
		scale string
		want  string
	}{
		{"no resize", "", "scale_vaapi=format=nv12"},
		{"plain resize", "scale=w=640:h=360", "scale_vaapi=w=640:h=360:format=nv12"},
		{"preset resize", scale720, "scale_vaapi=" + strings.TrimPrefix(scale720, "scale=") + ":format=nv12"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := vaapiScaleFilter(tc.scale); got != tc.want {
				t.Errorf("vaapiScaleFilter(%q) = %q, want %q", tc.scale, got, tc.want)
			}
		})
	}
}

// TestResolutionScaleFilterPrefix guards the assumption vaapiScaleFilter makes:
// every preset's software filter is a single scale= filter.
func TestResolutionScaleFilterPrefix(t *testing.T) {
	for resolution := range qualityPresets {
		scale, err := resolutionScaleFilter(resolution)
		if err != nil {
			t.Fatalf("resolutionScaleFilter(%q) returned error: %v", resolution, err)
		}
		// Commas inside the quoted min() expressions are fine; one between
		// filters would sit right after a closing quote.
		if !strings.HasPrefix(scale, "scale=") || strings.Contains(scale, "',") {
			t.Errorf("resolutionScaleFilter(%q) = %q, want a single scale= filter", resolution, scale)
		}
	}
}

// TestVAAPIFilters verifies both pipelines' -vf chains.
func TestVAAPIFilters(t *testing.T) {
	cases := []struct {
		name   string
		filter func(string) string
		scale  string
		want   string
	}{
		{"hardware, no resize", vaapiHWFilter, "", "format=nv12|vaapi,hwupload,scale_vaapi=format=nv12"},
		{"hardware, resize", vaapiHWFilter, "scale=w=640:h=360", "format=nv12|vaapi,hwupload,scale_vaapi=w=640:h=360:format=nv12"},
		{"upload, no resize", vaapiUploadFilter, "", "format=nv12,hwupload"},
		{"upload, resize", vaapiUploadFilter, "scale=w=640:h=360", "scale=w=640:h=360,format=nv12,hwupload"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.filter(tc.scale); got != tc.want {
				t.Errorf("filter(%q) = %q, want %q", tc.scale, got, tc.want)
			}
		})
	}
}

// TestVAAPIProfiles verifies the candidate order (full hardware before encode
// only, each normal before low-power) and that every profile opens the given
// render node.
func TestVAAPIProfiles(t *testing.T) {
	const device = "/dev/dri/renderD129"
	profiles := vaapiProfiles(device)
	want := []struct {
		hwDecode bool
		lowPower bool
	}{
		{true, false},
		{true, true},
		{false, false},
		{false, true},
	}
	if len(profiles) != len(want) {
		t.Fatalf("vaapiProfiles() returned %d profiles, want %d", len(profiles), len(want))
	}
	for i, p := range profiles {
		if p.Codec != "h264_vaapi" {
			t.Errorf("profile %d Codec = %q, want h264_vaapi", i, p.Codec)
		}
		if strings.Join(p.PreInput, " ") != "-vaapi_device "+device {
			t.Errorf("profile %d PreInput = %v, want -vaapi_device %s", i, p.PreInput, device)
		}
		if !strings.Contains(p.Name, "renderD129") {
			t.Errorf("profile %d Name = %q, want it to name the render node", i, p.Name)
		}
		hwDecode := strings.Join(p.DecodeArgs, " ") == "-hwaccel vaapi -hwaccel_output_format vaapi"
		if hwDecode != want[i].hwDecode {
			t.Errorf("profile %d (%s) DecodeArgs = %v, want hardware decode %v", i, p.Name, p.DecodeArgs, want[i].hwDecode)
		}
		if hwDecode != strings.Contains(p.ScaleFilter(""), "scale_vaapi") {
			t.Errorf("profile %d (%s) hardware decode %v does not match filter %q", i, p.Name, hwDecode, p.ScaleFilter(""))
		}
		lowPower := strings.Join(p.EncodeArgs, " ") == "-low_power 1"
		if lowPower != want[i].lowPower {
			t.Errorf("profile %d (%s) EncodeArgs = %v, want low power %v", i, p.Name, p.EncodeArgs, want[i].lowPower)
		}
	}
}

// TestVAAPIRenderNodes verifies a node is always offered, even on hosts with
// no /dev/dri (such as the Windows and macOS machines tests also run on).
func TestVAAPIRenderNodes(t *testing.T) {
	nodes := vaapiRenderNodes()
	if len(nodes) == 0 {
		t.Fatal("vaapiRenderNodes() returned no node")
	}
	for _, node := range nodes {
		if !strings.Contains(node, "renderD") {
			t.Errorf("vaapiRenderNodes() returned %q, want a render node", node)
		}
	}
}

// TestProbeArgsOmitDecodeArgs verifies the probe never asks for hardware
// decoding: its input is a synthetic lavfi source with no hardware decoder.
func TestProbeArgsOmitDecodeArgs(t *testing.T) {
	profile := vaapiProfiles(vaapiDefaultRenderNode)[0]
	args := probeArgs(profile)
	if indexOf(args, "-hwaccel") != -1 || indexOf(args, "-hwaccel_output_format") != -1 {
		t.Errorf("probeArgs() = %v, want no hardware decode options", args)
	}
	if vf := indexOf(args, "-vf"); vf == -1 || args[vf+1] != vaapiHWFilter("") {
		t.Errorf("probeArgs() = %v, want the full hardware filter chain", args)
	}
}

// TestDecodeArgsPlacement verifies the MP4 and HLS command lines put the
// hardware decode options after the device and seek and before -i, which is
// where ffmpeg reads input options from.
func TestDecodeArgsPlacement(t *testing.T) {
	hw := vaapiProfiles(vaapiDefaultRenderNode)[0]
	builders := map[string]func() ([]string, error){
		"mp4": func() ([]string, error) {
			return buildMP4Args("in.mkv", TranscodeResolution_720p, 30, hw)
		},
		"hls": func() ([]string, error) {
			return buildHLSArgs("in.mkv", t.TempDir(), TranscodeResolution_720p, 30, "/seg/", hw)
		},
	}
	for name, build := range builders {
		t.Run(name, func(t *testing.T) {
			args, err := build()
			if err != nil {
				t.Fatalf("build returned error: %v", err)
			}
			device := indexOf(args, "-vaapi_device")
			seek := indexOf(args, "-ss")
			hwaccel := indexOf(args, "-hwaccel")
			input := indexOf(args, "-i")
			if device == -1 || seek == -1 || hwaccel == -1 || input == -1 {
				t.Fatalf("missing -vaapi_device, -ss, -hwaccel or -i in %v", args)
			}
			if !(device < seek && seek < hwaccel && hwaccel < input) {
				t.Errorf("want -vaapi_device < -ss < -hwaccel < -i, got %d, %d, %d, %d\nargs: %v",
					device, seek, hwaccel, input, args)
			}
			vf := indexOf(args, "-vf")
			if vf == -1 || !strings.HasPrefix(args[vf+1], "format=nv12|vaapi,hwupload,scale_vaapi=") {
				t.Errorf("want the GPU scale chain after -vf, got %v", args)
			}
			if indexOf(args, "h264_vaapi") == -1 || indexOf(args, "libx264") != -1 {
				t.Errorf("want h264_vaapi and no libx264, got %v", args)
			}
		})
	}
}

// TestBuildMP4ArgsSoftware verifies the software path keeps libx264 with an
// 8-bit pixel format and asks for no hardware decoding.
func TestBuildMP4ArgsSoftware(t *testing.T) {
	args, err := buildMP4Args("in.mkv", TranscodeResolution_original, 0, nil)
	if err != nil {
		t.Fatalf("buildMP4Args returned error: %v", err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-vcodec libx264") || !strings.Contains(joined, "-pix_fmt yuv420p") {
		t.Errorf("want libx264 with yuv420p, got %v", args)
	}
	if indexOf(args, "-hwaccel") != -1 || indexOf(args, "-ss") != -1 || indexOf(args, "-vf") != -1 {
		t.Errorf("want no -hwaccel, -ss or -vf, got %v", args)
	}
	if args[len(args)-1] != "pipe:1" {
		t.Errorf("want output on pipe:1, got %v", args)
	}
	if _, err := buildMP4Args("in.mkv", "banana", 0, nil); err == nil {
		t.Error("buildMP4Args accepted an invalid resolution, want error")
	}
}
