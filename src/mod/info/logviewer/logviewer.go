package logviewer

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

type ViewerOption struct {
	RootFolder string //The root folder to scan for log
	Extension  string //The extension the root files use, include the . in your ext (e.g. .log)
}

type Viewer struct {
	option *ViewerOption
}

type LogFile struct {
	Title    string
	Filename string
	Fullpath string
	Filesize int64
}

func NewLogViewer(option *ViewerOption) *Viewer {
	logger.DebugTrace("info/logviewer", "NewLogViewer")
	return &Viewer{option: option}
}

/*
	Log Request Handlers
*/
//List all the log files in the log folder. Return in map[string]LogFile format
func (v *Viewer) HandleListLog(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("info/logviewer", "Viewer.HandleListLog", "v", v, "r", r))
	logFiles := v.ListLogFiles(false)
	js, _ := json.Marshal(logFiles)
	utils.SendJSONResponse(w, string(js))
}

// Read log of a given catergory and filename
// Require GET varaible: file and catergory
func (v *Viewer) HandleReadLog(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("info/logviewer", "Viewer.HandleReadLog", "v", v, "r", r))
	filename, err := utils.GetPara(r, "file")
	if err != nil {
		logger.DebugErr("info/logviewer", err)
		utils.SendErrorResponse(w, "invalid filename given")
		return
	}

	catergory, err := utils.GetPara(r, "catergory")
	if err != nil {
		logger.DebugErr("info/logviewer", err)
		utils.SendErrorResponse(w, "invalid catergory given")
		return
	}

	content, err := v.LoadLogFile(strings.TrimSpace(filepath.Base(catergory)), strings.TrimSpace(filepath.Base(filename)))
	if err != nil {
		logger.DebugErr("info/logviewer", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendTextResponse(w, content)
}

/*
	Log Access Functions
*/

// isCategoryLog reports whether path is a log the viewer can open: a file
// directly inside a category folder of root (root/<catergory>/<file>).
// Logs written straight into root by older versions, or nested deeper, are
// skipped because LoadLogFile could never find them.
func isCategoryLog(root string, path string) (out0 bool) {
	defer logger.Out1(logger.In2("info/logviewer", "isCategoryLog", "root", root, "path", path), &out0)
	catergoryDir := filepath.Dir(path)
	return filepath.Clean(filepath.Dir(catergoryDir)) == filepath.Clean(root)
}

func (v *Viewer) ListLogFiles(showFullpath bool) (out0 map[string][]*LogFile) {
	defer logger.Out1(logger.In2("info/logviewer", "Viewer.ListLogFiles", "v", v, "showFullpath", showFullpath), &out0)
	result := map[string][]*LogFile{}
	filepath.WalkDir(v.option.RootFolder, func(path string, di fs.DirEntry, err error) error {
		if filepath.Ext(path) == v.option.Extension && isCategoryLog(v.option.RootFolder, path) {
			catergory := filepath.Base(filepath.Dir(path))
			logList, ok := result[catergory]
			if !ok {
				//this catergory hasn't been scanned before.
				logList = []*LogFile{}
			}

			fullpath := arozfs.ToSlash(path)
			if !showFullpath {
				fullpath = ""
			}

			st, err := os.Stat(path)
			if err != nil {
				logger.DebugErr("info/logviewer", err)
				return nil
			}

			logList = append(logList, &LogFile{
				Title:    strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)),
				Filename: filepath.Base(path),
				Fullpath: fullpath,
				Filesize: st.Size(),
			})

			result[catergory] = logList
		}

		return nil
	})
	return result
}

func (v *Viewer) LoadLogFile(catergory string, filename string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("info/logviewer", "Viewer.LoadLogFile", "v", v, "catergory", catergory, "filename", filename), &out0, &out1)
	logFilepath := filepath.Join(v.option.RootFolder, catergory, filename)
	if utils.FileExists(logFilepath) {
		//Load it
		content, err := os.ReadFile(logFilepath)
		if err != nil {
			logger.DebugErr("info/logviewer", err)
			return "", err
		}

		return string(content), nil
	} else {
		return "", errors.New("log file not found")
	}
}
