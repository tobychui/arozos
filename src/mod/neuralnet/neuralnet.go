package neuralnet

import (
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/filesystem"
)

/*
	Neural Net Package

	Require darknet binary in system folder to work
*/

type ImageClass struct {
	Name       string
	Percentage float64
	Positions  []int
}

func getDarknetBinary() (string, error) {
	darknetRoot := "./system/neuralnet/"
	binaryName := "darknet_" + runtime.GOOS + "_" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	expectedDarknetBinary := filepath.Join(darknetRoot, binaryName)

	absPath, _ := filepath.Abs(expectedDarknetBinary)
	if !filesystem.FileExists(absPath) {
		return "", errors.New("Darknet executable not found on " + absPath)
	}

	return absPath, nil
}

//Analysis and get what is inside the image using Darknet19, fast but only support 1 main object
func AnalysisPhotoDarknet19(filename string) ([]*ImageClass, error) {
	results := []*ImageClass{}

	//Check darknet installed
	darknetBinary, err := getDarknetBinary()
	if err != nil {
		return results, err
	}

	//Check source image exists
	imageSourceAbs, err := filepath.Abs(filename)
	if !filesystem.FileExists(imageSourceAbs) || err != nil {
		return results, errors.New("Source file not found")
	}

	//Analysis the image
	cmd := exec.Command(darknetBinary, "classifier", "predict", "cfg/imagenet1k.data", "cfg/darknet19.cfg", "darknet19.weights", imageSourceAbs)
	cmd.Dir = filepath.Dir(darknetBinary)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return results, err
	}

	//Process the output text
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		if strings.Contains(line, "%:") {
			//This is a resulting line. Split and push it into results
			info := strings.Split(strings.TrimSpace(line), "%: ") //[0] => Percentage in string, [1] => tag
			if s, err := strconv.ParseFloat(info[0], 32); err == nil {
				thisClassification := ImageClass{
					Name:       info[1],
					Percentage: s,
					Positions:  []int{},
				}

				results = append(results, &thisClassification)
			}
		}
	}

	return results, nil
}

//Analysis what is in the image using YOLO3, very slow but support multiple objects
func AnalysisPhotoYOLO3(filename string) ([]*ImageClass, error) {
	results := []*ImageClass{}

	//Check darknet installed
	darknetBinary, err := getDarknetBinary()
	if err != nil {
		return results, err
	}

	//Check source image exists
	imageSourceAbs, err := filepath.Abs(filename)
	if !filesystem.FileExists(imageSourceAbs) || err != nil {
		return results, errors.New("Source file not found")
	}

	//Analysis the image
	cmd := exec.Command(darknetBinary, "detect", "cfg/yolov3.cfg", "yolov3.weights", imageSourceAbs, "-out")
	cmd.Dir = filepath.Dir(darknetBinary)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return results, err
	}

	lines := strings.Split(string(out), "\n")
	var previousClassificationObject *ImageClass = nil
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if len(line) > 0 && line[len(line)-1:] == "%" && strings.Contains(line, ":") {
			//This is a output value
			//Trim out the %
			line = line[:len(line)-1]
			info := strings.Split(line, ":") //[0] => class name, [1] => percentage
			if s, err := strconv.ParseFloat(strings.TrimSpace(info[1]), 32); err == nil {
				thisClassification := ImageClass{
					Name:       info[0],
					Percentage: s,
				}
				previousClassificationObject = &thisClassification
				results = append(results, &thisClassification)
			}
		} else if len(line) > 0 && line[:4] == "pos=" && strings.Contains(line, ",") && previousClassificationObject != nil {
			//This is position makeup data, append to previous classification
			positionsString := strings.Split(line[4:], ",")
			positionsInt := []int{}
			for _, pos := range positionsString {
				posInt, err := strconv.Atoi(pos)
				if err != nil {
					positionsInt = append(positionsInt, -1)
				} else {
					positionsInt = append(positionsInt, posInt)
				}
			}

			previousClassificationObject.Positions = positionsInt
		}
	}

	return results, nil
}
