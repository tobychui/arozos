package updates

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func getFileSize(filename string) int64 {
	fi, err := os.Stat(filename)
	if err != nil {
		return -1
	}
	// get the size
	return fi.Size()
}

func getDownloadFileSize(url string) (int, error) {
	headResp, err := http.Head(url)

	if err != nil {
		return -1, err
	}
	defer headResp.Body.Close()
	return strconv.Atoi(headResp.Header.Get("Content-Length"))
}

func downloadFile(url string, dest string) error {
	out, err := os.Create(dest)

	if err != nil {
		return err
	}

	defer out.Close()

	if err != nil {
		return err
	}

	resp, err := http.Get(url)

	if err != nil {
		return err
	}

	defer resp.Body.Close()

	_, err = io.Copy(out, resp.Body)

	if err != nil {
		return err
	}

	return nil
}

func extractTarGz(gzipStream io.Reader, unzipPath string, progressUpdateFunction func(int, float64, string)) error {
	uncompressedStream, err := gzip.NewReader(gzipStream)
	if err != nil {
		return err
	}

	tarReader := tar.NewReader(uncompressedStream)

	for {
		header, err := tarReader.Next()

		if err == io.EOF {
			break
		}

		if err != nil {
			return err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.Mkdir(filepath.Join(unzipPath, header.Name), 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			progressUpdateFunction(2, 100, "Extracting: "+header.Name)
			outFile, err := os.Create(filepath.Join(unzipPath, header.Name))
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tarReader); err != nil {
				return err
			}
			outFile.Close()

		default:
			return errors.New("Unable to decode .tar.gz")
		}
	}
	return nil
}

func getSHA1Hash(filename string) (string, error) {
	f, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha1.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func readCheckSumFile(fileContent string, filename string, checksum string) bool {
	checkSumFromFile := strings.Split(fileContent, "\r\n")
	for _, line := range checkSumFromFile {
		checkSumLine := strings.Split(line, " *")
		if checkSumLine[1] == filename {
			return checkSumLine[0] == checksum
		}
	}
	return false
}
