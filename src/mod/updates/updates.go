package updates

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// Download updates from given URL, return real time progress of stage (int),  progress (int) and status text (string)
func DownloadUpdatesFromURL(binaryURL string, webpackURL string, checksumURL string, progressUpdateFunction func(int, float64, string)) error {
	//Create the update download folder
	os.RemoveAll("./updates")
	os.MkdirAll("./updates", 0755)

	//Get the total size of download expected
	binarySize, webpackSize, err := GetUpdateSizes(binaryURL, webpackURL)
	if err != nil {
		return errors.New("Unable to access given URL")
	}

	//Generate the download position
	binaryDownloadTarget := "./updates/" + filepath.Base(binaryURL)
	webpackDownloadTarget := "./updates/" + filepath.Base(webpackURL)
	checksumDownloadTarget := "./updates/" + filepath.Base(checksumURL)

	//Check if the webpack is .tar.gz
	if filepath.Ext(webpackDownloadTarget) != ".gz" {
		//This is not a gzip file
		return errors.New("Webpack in invalid compression format")
	}

	//Start the download of binary
	//0 = false, 1 = true, 2 = error
	binaryDownloadComplete := 0
	webpackDownloadComplete := 0
	errorMessage := ""
	go func() {
		for binaryDownloadComplete == 0 {
			binaryFileSize := getFileSize(binaryDownloadTarget)
			progress := (float64(binaryFileSize) / float64(binarySize) * 100)
			progressUpdateFunction(0, progress, "Downloading binary")
			time.Sleep(100 * time.Millisecond)
		}

		if binaryDownloadComplete == 1 {
			progressUpdateFunction(0, 100, "Binary Download Completed")
		} else {
			progressUpdateFunction(0, 100, "Error: "+errorMessage)
			//Remove the update folder
			os.RemoveAll("./updates/")
		}

	}()
	err = downloadFile(binaryURL, binaryDownloadTarget)
	if err != nil {
		errorMessage = err.Error()
		binaryDownloadComplete = 2
		return err
	}
	binaryDownloadComplete = 1

	//Downlaod webpack
	go func() {
		for webpackDownloadComplete == 0 {
			webpackFileSize := getFileSize(webpackDownloadTarget)
			progress := (float64(webpackFileSize) / float64(webpackSize) * 100)
			progressUpdateFunction(1, progress, "Downloading webpack")
			time.Sleep(100 * time.Millisecond)
		}

		if webpackDownloadComplete == 1 {
			progressUpdateFunction(1, 100, "Webpack Download Completed")
		} else {
			progressUpdateFunction(1, 100, "Error: "+errorMessage)
			//Remove the update folder
			os.RemoveAll("./updates/")
		}
	}()
	err = downloadFile(webpackURL, webpackDownloadTarget)
	if err != nil {
		errorMessage = err.Error()
		webpackDownloadComplete = 2
		return err
	}
	webpackDownloadComplete = 1

	//Download completed.
	//check checksum if exists
	//just a small file, dont need progress bar
	if checksumURL != "" {
		err = downloadFile(checksumURL, checksumDownloadTarget)
		if err != nil {
			errorMessage = err.Error()
			return err
		}
		checksumFileContent, err := os.ReadFile(checksumDownloadTarget)
		if err != nil {
			errorMessage = err.Error()
			return err
		}
		binaryHash, err := getSHA1Hash(binaryDownloadTarget)
		if err != nil {
			errorMessage = err.Error()
			return err
		}
		webpackHash, err := getSHA1Hash(webpackDownloadTarget)
		if err != nil {
			errorMessage = err.Error()
			return err
		}
		binaryBool := readCheckSumFile(string(checksumFileContent), filepath.Base(binaryURL), binaryHash)
		webPackBool := readCheckSumFile(string(checksumFileContent), filepath.Base(webpackURL), webpackHash)
		os.Remove(checksumDownloadTarget)
		if !binaryBool {
			progressUpdateFunction(1, 100, "Binary checksum mismatch")
			errorMessage = "Binary checksum mismatch"
			return errors.New("Binary checksum mismatch")
		}
		if !webPackBool {
			progressUpdateFunction(1, 100, "Web pack checksum mismatch")
			errorMessage = "Web pack checksum mismatch"
			return errors.New("Web pack checksum mismatch")
		}
	}

	//Try unzip webpack
	gzipstrean, err := os.Open(webpackDownloadTarget)
	if err != nil {
		return err
	}
	progressUpdateFunction(2, 0, "Extracting webpack")

	err = extractTarGz(gzipstrean, "./updates/", progressUpdateFunction)
	if err != nil {
		return err
	}

	gzipstrean.Close()

	//Remove the webpack compressed file
	os.Remove(webpackDownloadTarget)
	progressUpdateFunction(3, 100, "Updates Downloaded")
	return nil
}

// Get the update sizes, return binary size, webpack size and error if any
func GetUpdateSizes(binaryURL string, webpackURL string) (int, int, error) {
	bps, err := getDownloadFileSize(binaryURL)
	if err != nil {
		return -1, -1, err
	}
	wps, err := getDownloadFileSize(webpackURL)
	if err != nil {
		return -1, -1, err
	}

	return bps, wps, nil
}

func GetLauncherVersion() (string, error) {
	//Check if there is a launcher listening to port 25576
	client := http.Client{
		Timeout: 3 * time.Second,
	}
	resp, err := client.Get("http://127.0.0.1:25576/chk")
	if err != nil {
		return "", errors.New("No launcher found. Unable to restart")
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", errors.New("Read launcher response failed")
	}

	return string(content), nil
}

func CheckLauncherPortResponsive() bool {
	client := http.Client{
		Timeout: 3 * time.Second,
	}
	_, err := client.Get("http://127.0.0.1:25576/chk")
	if err != nil {
		return false
	}

	return true
}
