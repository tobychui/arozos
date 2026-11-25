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

	"imuslab.com/arozos/mod/info/logger"
)

func getFileSize(filename string) (out0 int64) {
	defer logger.Out1(logger.In1("updates", "getFileSize", "filename", filename), &out0)
	fi, err := os.Stat(filename)
	if err != nil {
		logger.DebugErr("updates", err)
		return -1
	}
	// get the size
	return fi.Size()
}

func getDownloadFileSize(url string) (out0 int, out1 error) {
	defer logger.Out2(logger.In1("updates", "getDownloadFileSize", "url", url), &out0, &out1)
	headResp, err := http.Head(url)

	if err != nil {
		logger.DebugErr("updates", err)
		return -1, err
	}
	defer headResp.Body.Close()
	return strconv.Atoi(headResp.Header.Get("Content-Length"))
}

func downloadFile(url string, dest string) (out0 error) {
	defer logger.Out1(logger.In2("updates", "downloadFile", "url", url, "dest", dest), &out0)
	out, err := os.Create(dest)

	if err != nil {
		logger.DebugErr("updates", err)
		return err
	}

	defer out.Close()

	if err != nil {
		logger.DebugErr("updates", err)
		return err
	}

	resp, err := http.Get(url)

	if err != nil {
		logger.DebugErr("updates", err)
		return err
	}

	defer resp.Body.Close()

	_, err = io.Copy(out, resp.Body)

	if err != nil {
		logger.DebugErr("updates", err)
		return err
	}

	return nil
}

func extractTarGz(gzipStream io.Reader, unzipPath string, progressUpdateFunction func(int, float64, string)) (out0 error) {
	defer logger.Out1(logger.In3("updates", "extractTarGz", "gzipStream", gzipStream, "unzipPath", unzipPath, "progressUpdateFunction", progressUpdateFunction), &out0)
	uncompressedStream, err := gzip.NewReader(gzipStream)
	if err != nil {
		logger.DebugErr("updates", err)
		return err
	}

	tarReader := tar.NewReader(uncompressedStream)

	for {
		header, err := tarReader.Next()

		if err == io.EOF {
			break
		}

		if err != nil {
			logger.DebugErr("updates", err)
			return err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.Mkdir(filepath.Join(unzipPath, header.Name), 0755); err != nil {
				logger.DebugErr("updates", err)
				return err
			}
		case tar.TypeReg:
			progressUpdateFunction(2, 100, "Extracting: "+header.Name)
			outFile, err := os.Create(filepath.Join(unzipPath, header.Name))
			if err != nil {
				logger.DebugErr("updates", err)
				return err
			}
			if _, err := io.Copy(outFile, tarReader); err != nil {
				logger.DebugErr("updates", err)
				return err
			}
			outFile.Close()

		default:
			return errors.New("Unable to decode .tar.gz")
		}
	}
	return nil
}

func getSHA1Hash(filename string) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("updates", "getSHA1Hash", "filename", filename), &out0, &out1)
	f, err := os.Open(filename)
	if err != nil {
		logger.DebugErr("updates", err)
		return "", err
	}
	defer f.Close()

	h := sha1.New()
	if _, err := io.Copy(h, f); err != nil {
		logger.DebugErr("updates", err)
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func readCheckSumFile(fileContent string, filename string, checksum string) (out0 bool) {
	defer logger.Out1(logger.In3("updates", "readCheckSumFile", "fileContent", fileContent, "filename", filename, "checksum", checksum), &out0)
	checkSumFromFile := strings.Split(fileContent, "\r\n")
	for _, line := range checkSumFromFile {
		checkSumLine := strings.Split(line, " *")
		if checkSumLine[1] == filename {
			return checkSumLine[0] == checksum
		}
	}
	return false
}
