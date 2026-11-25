package syncserv

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	upload.go

	The upload endpoint. A request carries one or more files as the file
	fields of a form (multipart/form-data), or a single file as the body
	with its name in the Filename header. A "date" field may carry the date
	the photo was taken, for the date folders.

	Every file is received into the spool folder first: its size is only
	known then, and so is its date when the file has to be read for it.
	Then, under a lock per user, the server decides whether the file is
	already there and moves it into place.
*/

const (
	maxFilesPerRequest  = 64
	maxFieldsPerRequest = 32
	maxFieldBytes       = 4096
	maxSameNames        = 99
)

// Results of a file
const (
	ResultSaved    = "saved"
	ResultReplaced = "replaced"
	ResultSkipped  = "skipped"
	ResultFailed   = "failed"
)

// Why a file was skipped or failed
const (
	ReasonReceived  = "received"  //A file of this name came in the last 30 days
	ReasonExists    = "exists"    //The same file is in the folder
	ReasonUnchanged = "unchanged" //The file it would replace has the same content
	ReasonQuota     = "quota"
	ReasonError     = "error"
)

var (
	errTooLarge = errors.New("too large")
	errNoFile   = errors.New("The request carries no file. Send it as a file field of a form, or as the body with its name in the Filename header.")
)

// FileResult is what happened to one file.
type FileResult struct {
	Name   string `json:"name"`
	Result string `json:"result"`
	Reason string `json:"reason,omitempty"`
	Error  string `json:"error,omitempty"`
	Path   string `json:"path,omitempty"`
}

// UploadResult is the answer to an upload request.
type UploadResult struct {
	User    string       `json:"user"`
	Saved   int          `json:"saved"`
	Skipped int          `json:"skipped"`
	Failed  int          `json:"failed"`
	Files   []FileResult `json:"files"`
}

// incoming is a file received into the spool folder.
type incoming struct {
	name        string //As the client sent it
	contentType string
	spool       string
	size        int64
}

// reply answers with JSON. < > & stay as they are: the answer is read by
// people in the result view of a shortcut, never put into a page.
func reply(w http.ResponseWriter, status int, value interface{}) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "reply: status=%d", status)
	}
	buf := &bytes.Buffer{}
	encoder := json.NewEncoder(buf)
	encoder.SetEscapeHTML(false)
	encoder.Encode(value)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	w.Write(bytes.TrimRight(buf.Bytes(), "\n"))
}

func replyError(w http.ResponseWriter, status int, text string) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("fileservers/servers/syncserv", "replyError: status=%d", status)
	}
	reply(w, status, map[string]string{"error": text})
}

func askForPassword(w http.ResponseWriter, status int, text string) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "askForPassword: status=%d", status)
	}
	w.Header().Set("WWW-Authenticate", `Basic realm="ArozOS Sync Server", charset="UTF-8"`)
	replyError(w, status, text)
}

// HandleUpload is the upload endpoint. It signs requests in itself, so it
// is registered outside the session router (syncserver.go).
func (m *Manager) HandleUpload(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.HandleUpload: r=%s", logger.RequestSummary(r))
	}
	w.Header().Set("Cache-Control", "no-store")
	if !m.IsEnabled() {
		replyError(w, http.StatusServiceUnavailable, "The sync server is turned off")
		return
	}
	remote := ""
	if m.opt.ClientIP != nil {
		remote = m.opt.ClientIP(r)
	}
	if m.opt.AllowIP != nil {
		if err := m.opt.AllowIP(remote); err != nil {
			replyError(w, http.StatusForbidden, err.Error())
			return
		}
	}

	username, password := credentials(r)
	if username == "" {
		askForPassword(w, http.StatusUnauthorized, "Send your user name in the Username header (or X-User-Name)")
		return
	}
	if password == "" {
		askForPassword(w, http.StatusUnauthorized, "Send your password in the Authorization header, as Bearer <password>. If a proxy in front of the server removes that header, send the password alone in X-User-Cred")
		return
	}
	now := time.Now()
	if wait := m.limits.wait(username, remote, now); wait > 0 {
		seconds := int(wait.Seconds() + 0.999)
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		replyError(w, http.StatusTooManyRequests, "Too many wrong passwords. Try again in "+strconv.Itoa(seconds)+" seconds")
		return
	}

	//Whether the server is on for the account is asked first, so that the
	//password of an account without it is never checked here
	settings, active := m.Settings(username)
	err := errRefused
	if active {
		err = m.checkPassword(username, password, settings)
	}
	if m.opt.LogAuth != nil {
		m.opt.LogAuth(username, remote, err == nil)
	}
	if err != nil {
		m.limits.miss(username, remote, now)
		askForPassword(w, http.StatusUnauthorized, refusedSignIn)
		return
	}
	m.limits.clear(username, remote)
	if !m.Allowed(username) {
		replyError(w, http.StatusForbidden, "Your account may not use the sync server. An administrator can allow your group.")
		return
	}

	switch r.Method {
	case http.MethodGet, http.MethodHead:
		//Lets a phone or a browser test the address and the password
		reply(w, http.StatusOK, map[string]interface{}{
			"ok":        true,
			"user":      username,
			"folder":    settings.Folder,
			"maxFileMB": m.Config().MaxFileMB,
		})
		return
	case http.MethodPost, http.MethodPut:
	default:
		w.Header().Set("Allow", "GET, HEAD, POST, PUT")
		replyError(w, http.StatusMethodNotAllowed, "Send files with POST")
		return
	}

	folder, err := m.opt.OpenFolder(username, settings.Folder)
	if err != nil {
		m.noteFailure(username, remote, now, "The sync folder cannot be used: "+err.Error())
		replyError(w, http.StatusConflict, "The sync folder cannot be used: "+err.Error())
		return
	}

	maxMB := m.Config().MaxFileMB
	files, fields, err := m.receive(r, maxMB<<20)
	defer func() {
		for _, f := range files {
			os.Remove(f.spool)
		}
	}()
	switch {
	case errors.Is(err, errTooLarge):
		text := "The file is larger than the " + strconv.FormatInt(maxMB, 10) + " MB this server accepts"
		m.noteFailure(username, remote, now, text)
		replyError(w, http.StatusRequestEntityTooLarge, text)
		return
	case err != nil:
		replyError(w, http.StatusBadRequest, "The upload could not be read: "+err.Error())
		return
	case len(files) == 0:
		replyError(w, http.StatusBadRequest, errNoFile.Error())
		return
	}

	dateText := ""
	for _, key := range []string{"date", "datetaken", "date taken", "created", "creationdate", "creation date"} {
		if value := strings.TrimSpace(fields[key]); value != "" {
			dateText = value
			break
		}
	}

	m.pruneSeen(username, now)
	result := UploadResult{User: username, Files: []FileResult{}}
	for _, f := range files {
		res := m.store(username, settings, folder, f, dateText, now)
		switch res.Result {
		case ResultSaved, ResultReplaced:
			result.Saved++
		case ResultSkipped:
			result.Skipped++
		default:
			result.Failed++
		}
		result.Files = append(result.Files, res)
	}
	m.noteResult(username, remote, now, result)

	status := http.StatusOK
	if result.Failed > 0 && result.Saved+result.Skipped == 0 {
		status = http.StatusInternalServerError
		if result.Files[0].Reason == ReasonQuota {
			status = http.StatusInsufficientStorage
		}
	}
	reply(w, status, result)
}

// HandleOtherPath answers every other address below /api/syncserver/. A
// trailing slash still uploads; anything else says where uploads go, so a
// typo in a shortcut shows up as such instead of as the login page.
func (m *Manager) HandleOtherPath(w http.ResponseWriter, r *http.Request) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.HandleOtherPath: r=%s", logger.RequestSummary(r))
	}
	if strings.TrimRight(r.URL.Path, "/") == UploadPath {
		m.HandleUpload(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	replyError(w, http.StatusNotFound, "No such address. Upload to "+UploadPath)
}

// receive reads the files and fields of an upload into the spool folder.
// The files received are returned even with an error, so they are removed.
func (m *Manager) receive(r *http.Request, limit int64) ([]incoming, map[string]string, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.receive: r=%s limit=%d", logger.RequestSummary(r), limit)
	}
	files := []incoming{}
	fields := map[string]string{}
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if !strings.HasPrefix(mediaType, "multipart/") {
		//The body is the file
		name := firstHeader(r, "Filename", "X-Filename")
		if _, params, err := mime.ParseMediaType(r.Header.Get("Content-Disposition")); name == "" && err == nil {
			name = params["filename"]
		}
		if name == "" {
			name = r.URL.Query().Get("filename")
		}
		if date := firstHeader(r, "X-Date", "Date-Taken"); date != "" {
			fields["date"] = date
		} else if date := r.URL.Query().Get("date"); date != "" {
			fields["date"] = date
		}
		f, err := m.spool(r.Body, limit)
		if err != nil {
			return files, fields, err
		}
		if f.size == 0 {
			os.Remove(f.spool)
			return files, fields, nil
		}
		f.name, f.contentType = name, r.Header.Get("Content-Type")
		return append(files, f), fields, nil
	}

	reader, err := r.MultipartReader()
	if err != nil {
		return files, fields, err
	}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return files, fields, nil
		}
		if err != nil {
			return files, fields, err
		}
		name := part.FileName()
		contentType := part.Header.Get("Content-Type")
		if name == "" && (contentType == "" || strings.HasPrefix(strings.ToLower(contentType), "text/plain")) {
			//A text field
			value, _ := io.ReadAll(io.LimitReader(part, maxFieldBytes))
			key := strings.ToLower(strings.TrimSpace(part.FormName()))
			if _, ok := fields[key]; !ok && len(fields) < maxFieldsPerRequest {
				fields[key] = string(value)
			}
			part.Close()
			continue
		}
		if len(files) >= maxFilesPerRequest {
			part.Close()
			return files, fields, errors.New("at most " + strconv.Itoa(maxFilesPerRequest) + " files can be sent in one request")
		}
		f, err := m.spool(part, limit)
		part.Close()
		if err != nil {
			return files, fields, err
		}
		f.name, f.contentType = name, contentType
		files = append(files, f)
	}
}

// spool copies an upload into a file of the spool folder.
func (m *Manager) spool(src io.Reader, limit int64) (incoming, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.spool: limit=%d", limit)
	}
	if err := os.MkdirAll(m.opt.SpoolDir, 0755); err != nil {
		return incoming{}, err
	}
	out, err := os.CreateTemp(m.opt.SpoolDir, "upload-*.part")
	if err != nil {
		return incoming{}, err
	}
	reader := src
	if limit > 0 {
		reader = io.LimitReader(src, limit+1)
	}
	n, err := io.Copy(out, reader)
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err == nil && limit > 0 && n > limit {
		err = errTooLarge
	}
	if err != nil {
		os.Remove(out.Name())
		return incoming{}, err
	}
	return incoming{spool: out.Name(), size: n}, nil
}

func readHead(name string, n int) []byte {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "readHead: name=%.120q n=%d", name, n)
	}
	f, err := os.Open(name)
	if err != nil {
		return nil
	}
	defer f.Close()
	head := make([]byte, n)
	read, _ := io.ReadFull(f, head)
	return head[:read]
}

// fileMediaDate reads the date of a received file. A file that trips the
// reader costs its date, never the upload.
func fileMediaDate(name string, size int64) (when time.Time, ok bool) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "fileMediaDate: name=%.120q size=%d", name, size)
	}
	defer func() {
		if recover() != nil {
			when, ok = time.Time{}, false
		}
	}()
	f, err := os.Open(name)
	if err != nil {
		return time.Time{}, false
	}
	defer f.Close()
	return MediaDate(f, size)
}

// genericStems are names that tell nothing about the file: what iOS calls
// edited photos, and what some apps call everything they share.
var genericStems = map[string]bool{
	"fullsizerender": true,
	"upload":         true,
	"image":          true,
	"photo":          true,
	"video":          true,
	"file":           true,
	"untitled":       true,
	"blob":           true,
}

// GenericName tells whether a file name says nothing about the file.
func GenericName(name string) bool {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "GenericName: name=%.120q", name)
	}
	stem := strings.ToLower(strings.TrimSuffix(name, path.Ext(name)))
	return genericStems[stem] || strings.HasPrefix(stem, "fullsizerender")
}

// distinctName adds the date taken, else the start of the content's hash,
// to a generic name.
func distinctName(name string, taken time.Time, haveTaken bool, spool string) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "distinctName: name=%.120q haveTaken=%t spool=%.120q", name, haveTaken, spool)
	}
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if haveTaken {
		return stem + "_" + taken.Format("20060102_150405") + ext
	}
	sum := sha256.New()
	if f, err := os.Open(spool); err == nil {
		io.Copy(sum, f)
		f.Close()
	}
	return stem + "_" + hex.EncodeToString(sum.Sum(nil))[:12] + ext
}

// store decides where a received file goes and puts it there.
func (m *Manager) store(username string, settings UserSettings, folder Folder, f incoming, dateText string, now time.Time) FileResult {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.store: username=%.120q dateText=%.120q", username, dateText)
	}
	name := CleanName(f.name)
	if name == "" || path.Ext(name) == "" {
		ext := sniffExt(readHead(f.spool, 512), f.contentType)
		if name == "" {
			name = "Upload" + ext
		} else {
			name += ext
		}
	}

	taken, haveTaken := ParseDate(dateText)
	if !haveTaken {
		taken, haveTaken = fileMediaDate(f.spool, f.size)
	}
	if GenericName(name) {
		//iOS names every edited photo FullSizeRender, and a file sent without
		//a name is called Upload, so the name alone would make them all one
		//file. The date taken, else the content, tells them apart, and stays
		//the same when the phone sends the file again.
		name = distinctName(name, taken, haveTaken, f.spool)
	}

	when := now
	if settings.DateSource == SourceCreated && haveTaken {
		when = taken
	}
	rel := name
	if sub := Subfolder(settings, Classify(name), when); sub != "" {
		rel = sub + "/" + name
	}

	lock := m.userLock(username)
	lock.Lock()
	defer lock.Unlock()
	if settings.Duplicates == DuplicateOverwrite {
		return m.storeReplacing(username, folder, f, name, rel, now)
	}
	return m.storeSkipping(username, folder, f, name, rel, now)
}

func numberedRel(rel string, n int) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "numberedRel: rel=%.120q n=%d", rel, n)
	}
	dir, file := path.Split(rel)
	return dir + Numbered(file, n)
}

// storeSkipping keeps what is there: a name received in the last 30 days is
// skipped wherever the file went since, and so is a file of the same name
// and size in the folder. A different file of the same name is kept as well,
// as "name (1).ext".
func (m *Manager) storeSkipping(username string, folder Folder, f incoming, name, rel string, now time.Time) FileResult {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.storeSkipping: username=%.120q name=%.120q rel=%.120q", username, name, rel)
	}
	if entry, ok := m.seen(username, name, now); ok {
		return FileResult{Name: name, Result: ResultSkipped, Reason: ReasonReceived, Path: folder.VirtualPath(entry.P)}
	}
	target := rel
	for n := 1; ; n++ {
		exists, isDir, size := folder.Stat(target)
		if !exists {
			break
		}
		if !isDir && size == f.size {
			m.remember(username, name, target, now)
			return FileResult{Name: name, Result: ResultSkipped, Reason: ReasonExists, Path: folder.VirtualPath(target)}
		}
		if n > maxSameNames {
			return FileResult{Name: name, Result: ResultFailed, Reason: ReasonError, Error: "Too many different files of this name"}
		}
		target = numberedRel(rel, n)
	}
	return m.place(username, folder, f, name, target, 0, now, ResultSaved)
}

// storeReplacing puts the file in place of the one there. A name received in
// the last 30 days replaces that copy, wherever it went, so a date folder
// that changed (by upload date, around midnight) does not leave two.
func (m *Manager) storeReplacing(username string, folder Folder, f incoming, name, rel string, now time.Time) FileResult {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.storeReplacing: username=%.120q name=%.120q rel=%.120q", username, name, rel)
	}
	target := rel
	if entry, ok := m.seen(username, name, now); ok && entry.P != rel {
		if exists, isDir, _ := folder.Stat(entry.P); exists && !isDir {
			target = entry.P
		}
	}
	exists, isDir, size := folder.Stat(target)
	if isDir {
		return FileResult{Name: name, Result: ResultFailed, Reason: ReasonError, Error: "A folder of this name is in the way"}
	}
	if exists && size == f.size && sameContent(folder, target, f.spool) {
		m.remember(username, name, target, now)
		return FileResult{Name: name, Result: ResultSkipped, Reason: ReasonUnchanged, Path: folder.VirtualPath(target)}
	}
	if !exists {
		return m.place(username, folder, f, name, target, 0, now, ResultSaved)
	}
	return m.place(username, folder, f, name, target, size, now, ResultReplaced)
}

func (m *Manager) place(username string, folder Folder, f incoming, name, target string, freed int64, now time.Time, result string) FileResult {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.place: username=%.120q name=%.120q target=%.120q freed=%d result=%.120q", username, name, target, freed, result)
	}
	if !folder.HaveSpace(f.size - freed) {
		return FileResult{Name: name, Result: ResultFailed, Reason: ReasonQuota, Error: "Your storage quota is full"}
	}
	if err := folder.Place(f.spool, target); err != nil {
		logger.PrintAndLog(logTitle, "Could not save "+name+" for "+username, err)
		return FileResult{Name: name, Result: ResultFailed, Reason: ReasonError, Error: "The file could not be saved: " + err.Error()}
	}
	m.remember(username, name, target, now)
	return FileResult{Name: name, Result: result, Path: folder.VirtualPath(target)}
}

// sameContent compares a file in the folder with a received one.
func sameContent(folder Folder, rel, spool string) bool {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "sameContent: rel=%.120q spool=%.120q", rel, spool)
	}
	a, err := folder.Open(rel)
	if err != nil {
		return false
	}
	defer a.Close()
	b, err := os.Open(spool)
	if err != nil {
		return false
	}
	defer b.Close()
	bufA := make([]byte, 64<<10)
	bufB := make([]byte, 64<<10)
	for {
		na, errA := io.ReadFull(a, bufA)
		nb, errB := io.ReadFull(b, bufB)
		if na != nb || !bytes.Equal(bufA[:na], bufB[:nb]) {
			return false
		}
		doneA := errA == io.EOF || errA == io.ErrUnexpectedEOF
		doneB := errB == io.EOF || errB == io.ErrUnexpectedEOF
		if doneA || doneB {
			return doneA && doneB
		}
		if errA != nil || errB != nil {
			return false
		}
	}
}

/*
	Activity
*/

func (m *Manager) noteResult(username, remote string, now time.Time, result UploadResult) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.noteResult: username=%.120q remote=%.120q", username, remote)
	}
	lock := m.userLock(username)
	lock.Lock()
	defer lock.Unlock()
	activity := m.activity(username)
	activity.Last = now.Unix()
	activity.Address = remote
	activity.Saved += int64(result.Saved)
	activity.Skipped += int64(result.Skipped)
	activity.Failed += int64(result.Failed)
	activity.LastError = ""
	for _, f := range result.Files {
		switch f.Result {
		case ResultSaved, ResultReplaced:
			activity.LastFile = f.Path
			activity.LastSaved = now.Unix()
		case ResultFailed:
			activity.LastError = f.Name + ": " + f.Error
		}
	}
	m.opt.Sysdb.Write(settingsTable, prefixStats+username, activity)
}

func (m *Manager) noteFailure(username, remote string, now time.Time, text string) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/syncserv", "Manager.noteFailure: username=%.120q remote=%.120q", username, remote)
	}
	lock := m.userLock(username)
	lock.Lock()
	defer lock.Unlock()
	activity := m.activity(username)
	activity.Last = now.Unix()
	activity.Address = remote
	activity.Failed++
	activity.LastError = text
	m.opt.Sysdb.Write(settingsTable, prefixStats+username, activity)
}
