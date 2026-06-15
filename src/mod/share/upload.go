package share

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash/crc32"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	uuid "github.com/satori/go.uuid"

	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

const (
	defaultUploadLinkTTLSeconds   int64 = 24 * 60 * 60
	defaultUploadLinkMaxFileCount int64 = 10
	defaultUploadLinkMaxFileSize  int64 = 100 << 20
	defaultUploadLinkMaxTotalSize int64 = 1 << 30
	publicPostUploadCutoff        int64 = 25 << 20
)

type uploadLinkResponse struct {
	UUID               string
	TargetVirtualPath  string
	Owner              string
	CreatedUnix        int64
	ExpiresUnix        int64
	MaxFileCount       int64
	MaxFileSize        int64
	MaxTotalSize       int64
	UploadedFileCount  int64
	UploadedBytes      int64
	Disabled           bool
	RemainingFileCount int64
	RemainingBytes     int64
	URL                string
}

type uploadContext struct {
	Link        *shareEntry.UploadLinkOption
	Owner       *user.User
	TargetFsh   *filesystem.FileSystemHandler
	TargetDir   string
	DestPath    string
	UploadSize  int64
	releaseName func()
}

func (s *Manager) HandleCreateUploadLink(w http.ResponseWriter, r *http.Request) {
	table, err := s.getUploadLinkTable()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	if err := r.ParseForm(); err != nil {
		utils.SendErrorResponse(w, "Invalid upload link settings")
		return
	}
	vpath := r.Form.Get("path")
	targetFsh, _, err := s.validateUploadLinkTarget(userinfo, vpath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	now := time.Now().Unix()
	ttlSeconds := parseInt64FormDefault(r, "ttl", defaultUploadLinkTTLSeconds)
	maxFileCount := parseInt64FormDefault(r, "maxFileCount", defaultUploadLinkMaxFileCount)
	maxFileSize := parseInt64FormDefault(r, "maxFileSize", defaultUploadLinkMaxFileSize)
	maxTotalSize := parseInt64FormDefault(r, "maxTotalSize", defaultUploadLinkMaxTotalSize)
	maxFileCount, maxFileSize, maxTotalSize, err = s.normalizeUploadLinkLimits(userinfo, maxFileCount, maxFileSize, maxTotalSize)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	link, err := table.CreateNewUploadLink(targetFsh, vpath, userinfo.Username, now, now+ttlSeconds, maxFileCount, maxFileSize, maxTotalSize)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(s.toUploadLinkResponse(link, r))
	utils.SendJSONResponse(w, string(js))
}

func (s *Manager) HandleEditUploadLink(w http.ResponseWriter, r *http.Request) {
	table, err := s.getUploadLinkTable()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	if err := r.ParseForm(); err != nil {
		utils.SendErrorResponse(w, "Invalid upload link settings")
		return
	}
	linkUUID := r.Form.Get("uuid")
	link := table.GetUploadLinkFromUUID(linkUUID)
	if link == nil {
		utils.SendErrorResponse(w, "Upload link UUID not exists")
		return
	}
	if !s.canModifyUploadLink(userinfo, link) {
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	owner, err := s.options.UserHandler.GetUserInfoFromUsername(link.Owner)
	if err != nil {
		utils.SendErrorResponse(w, "Upload link owner not exists")
		return
	}

	maxFileCount := parseInt64FormDefault(r, "maxFileCount", link.MaxFileCount)
	maxFileSize := parseInt64FormDefault(r, "maxFileSize", link.MaxFileSize)
	maxTotalSize := parseInt64FormDefault(r, "maxTotalSize", link.MaxTotalSize)
	maxFileCount, maxFileSize, maxTotalSize, err = s.normalizeUploadLinkLimits(owner, maxFileCount, maxFileSize, maxTotalSize)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	updated := *link
	updated.MaxFileCount = maxFileCount
	updated.MaxFileSize = maxFileSize
	updated.MaxTotalSize = maxTotalSize
	if ttl := r.Form.Get("ttl"); ttl != "" {
		ttlSeconds, err := strconv.ParseInt(strings.TrimSpace(ttl), 10, 64)
		if err != nil || ttlSeconds <= 0 {
			utils.SendErrorResponse(w, "Invalid link ttl")
			return
		}
		updated.ExpiresUnix = time.Now().Unix() + ttlSeconds
	}
	if disabled := r.Form.Get("disabled"); disabled != "" {
		updated.Disabled = disabled == "true" || disabled == "1"
	}

	if err := table.UpdateUploadLink(&updated); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(s.toUploadLinkResponse(&updated, r))
	utils.SendJSONResponse(w, string(js))
}

func (s *Manager) HandleDeleteUploadLink(w http.ResponseWriter, r *http.Request) {
	table, err := s.getUploadLinkTable()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	if err := r.ParseForm(); err != nil {
		utils.SendErrorResponse(w, "Invalid upload link settings")
		return
	}
	linkUUID := r.Form.Get("uuid")
	link := table.GetUploadLinkFromUUID(linkUUID)
	if link == nil {
		utils.SendErrorResponse(w, "Upload link UUID not exists")
		return
	}
	if !s.canModifyUploadLink(userinfo, link) {
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	if err := table.DeleteUploadLinkByUUID(linkUUID); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func (s *Manager) HandleListUploadLinks(w http.ResponseWriter, r *http.Request) {
	table, err := s.getUploadLinkTable()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	userinfo, err := s.options.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	results := []*shareEntry.UploadLinkOption{}
	vpath := r.URL.Query().Get("path")
	if vpath != "" {
		fsh := userinfo.GetRootFSHFromVpathInUserScope(vpath)
		if fsh == nil {
			utils.SendErrorResponse(w, "Invalid path given")
			return
		}
		pathHash, err := shareEntry.GetPathHash(fsh, vpath, userinfo.Username)
		if err != nil {
			utils.SendErrorResponse(w, "Unable to get upload links from given path")
			return
		}
		results = table.ListUploadLinksByPathHash(pathHash)
	} else {
		results = table.ListUploadLinksByOwner(userinfo.Username)
	}

	reduced := []uploadLinkResponse{}
	for _, link := range results {
		if s.canModifyUploadLink(userinfo, link) {
			reduced = append(reduced, s.toUploadLinkResponse(link, r))
		}
	}

	js, _ := json.Marshal(reduced)
	utils.SendJSONResponse(w, string(js))
}

func (s *Manager) HandleUploadLinkAccess(w http.ResponseWriter, r *http.Request, cleanParts []string) {
	if len(cleanParts) < 3 {
		http.NotFound(w, r)
		return
	}

	if len(cleanParts) == 3 {
		s.HandlePublicUploadLinkPage(w, r, cleanParts[2])
		return
	}

	switch cleanParts[2] {
	case "post":
		if len(cleanParts) < 4 {
			http.NotFound(w, r)
			return
		}
		s.HandlePublicUploadLinkPost(w, r, cleanParts[3])
	case "ws":
		if len(cleanParts) < 4 {
			http.NotFound(w, r)
			return
		}
		s.HandlePublicUploadLinkWebSocket(w, r, cleanParts[3])
	default:
		http.NotFound(w, r)
	}
}

func (s *Manager) HandlePublicUploadLinkPage(w http.ResponseWriter, r *http.Request, linkUUID string) {
	table, err := s.getUploadLinkTable()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	link := table.GetUploadLinkFromUUID(linkUUID)
	if link == nil || !link.IsActive(time.Now().Unix()) {
		ServePermissionDeniedPage(w)
		return
	}

	content, err := utils.Templateload("./system/share/uploadPage.html", map[string]string{
		"hostname":         html.EscapeString(s.options.HostName),
		"target":           html.EscapeString(arozfs.Base(link.TargetVirtualPath)),
		"uuid":             html.EscapeString(link.UUID),
		"uploadurl":        "/share/upload/post/" + link.UUID,
		"wsurl":            "/share/upload/ws/" + link.UUID,
		"maxfilesize":      strconv.FormatInt(link.MaxFileSize, 10),
		"remainingfiles":   strconv.FormatInt(remainingUploadFileCount(link), 10),
		"remainingbytes":   strconv.FormatInt(remainingUploadBytes(link), 10),
		"postcutoff":       strconv.FormatInt(publicPostUploadCutoff, 10),
		"expires":          strconv.FormatInt(link.ExpiresUnix, 10),
		"uploadedfiles":    strconv.FormatInt(link.UploadedFileCount, 10),
		"uploadedbytes":    strconv.FormatInt(link.UploadedBytes, 10),
		"maxfilecount":     strconv.FormatInt(link.MaxFileCount, 10),
		"maxtotalsize":     strconv.FormatInt(link.MaxTotalSize, 10),
		"server_timestamp": strconv.FormatInt(time.Now().Unix(), 10),
	})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Internal Server Error"))
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(content))
}

func (s *Manager) HandlePublicUploadLinkPost(w http.ResponseWriter, r *http.Request, linkUUID string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	maxBodySize, err := s.maxPublicUploadBodySize(linkUUID)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if maxBodySize > 0 {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodySize+(1<<20))
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		utils.SendErrorResponse(w, "File too large")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, handler, err := r.FormFile("file")
	if err != nil {
		utils.SendErrorResponse(w, "Unable to parse file from upload")
		return
	}
	defer file.Close()

	ctx, err := s.prepareUploadLinkUpload(linkUUID, handler.Filename, handler.Size)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	defer ctx.releaseName()

	if err := ctx.TargetFsh.FileSystemAbstraction.WriteStream(ctx.DestPath, file, 0775); err != nil {
		s.options.UploadLinkTable.ReleaseUpload(ctx.Link.UUID, ctx.UploadSize)
		utils.SendErrorResponse(w, "Write upload to destination disk failed")
		return
	}

	if err := s.completeUploadLinkUpload(ctx, ctx.UploadSize); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(map[string]string{
		"status":   "OK",
		"filename": arozfs.Base(ctx.DestPath),
	})
	utils.SendJSONResponse(w, string(js))
}

func (s *Manager) HandlePublicUploadLinkWebSocket(w http.ResponseWriter, r *http.Request, linkUUID string) {
	filename, err := utils.GetPara(r, "filename")
	if filename == "" || err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("400 - Invalid filename given"))
		return
	}
	sizeStr, err := utils.GetPara(r, "size")
	if sizeStr == "" || err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("400 - Invalid size given"))
		return
	}
	uploadSize, err := strconv.ParseInt(sizeStr, 10, 64)
	if err != nil || uploadSize <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("400 - Invalid size given"))
		return
	}

	ctx, err := s.prepareUploadLinkUpload(linkUUID, filename, uploadSize)
	if err != nil {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("403 - " + err.Error()))
		return
	}
	defer ctx.releaseName()

	uploadFolder := filepath.Join(s.options.TmpFolder, "uploads", uuid.NewV4().String())
	if err := os.MkdirAll(uploadFolder, 0700); err != nil {
		s.options.UploadLinkTable.ReleaseUpload(ctx.Link.UUID, ctx.UploadSize)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Unable to create upload buffer"))
		return
	}
	defer os.RemoveAll(uploadFolder)

	var upgrader = websocket.Upgrader{}
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.options.UploadLinkTable.ReleaseUpload(ctx.Link.UUID, ctx.UploadSize)
		return
	}
	defer c.Close()

	if err := s.receiveUploadLinkChunks(c, uploadFolder, uploadSize); err != nil {
		s.options.UploadLinkTable.ReleaseUpload(ctx.Link.UUID, ctx.UploadSize)
		c.WriteMessage(1, []byte(`{"error":"`+escapeJSONError(err.Error())+`"}`))
		return
	}

	if err := mergeUploadLinkChunks(uploadFolder, ctx.DestPath, ctx.TargetFsh); err != nil {
		s.options.UploadLinkTable.ReleaseUpload(ctx.Link.UUID, ctx.UploadSize)
		c.WriteMessage(1, []byte(`{"error":"Failed to write upload to destination disk"}`))
		return
	}

	if err := s.completeUploadLinkUpload(ctx, uploadSize); err != nil {
		c.WriteMessage(1, []byte(`{"error":"`+escapeJSONError(err.Error())+`"}`))
		return
	}

	c.WriteMessage(1, []byte(`{"status":"OK","filename":"`+escapeJSONError(arozfs.Base(ctx.DestPath))+`"}`))
	c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
}

func (s *Manager) receiveUploadLinkChunks(c *websocket.Conn, uploadFolder string, expectedSize int64) error {
	blockCounter := 0
	chunkName := []string{}
	totalFileSize := int64(0)
	fileCRC32Hasher := crc32.NewIEEE()

	var pendingChunkIndex int
	var pendingChunkChecksum string
	expectingBinary := false
	lastChunkArrivalTime := time.Now().Unix()

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	done := make(chan bool)
	defer close(done)
	go func() {
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if time.Now().Unix()-lastChunkArrivalTime > 300 {
					c.WriteControl(8, []byte{}, time.Now().Add(time.Second))
					c.Close()
					return
				}
			}
		}
	}()

	for {
		mt, message, err := c.ReadMessage()
		if err != nil {
			return errors.New("Upload terminated by client")
		}

		if mt == 1 {
			textMsg := strings.TrimSpace(string(message))
			if !expectingBinary {
				var doneSignal struct {
					Done         bool   `json:"done"`
					TotalChunks  int    `json:"totalChunks"`
					FileChecksum string `json:"fileChecksum"`
				}
				if jsonErr := json.Unmarshal([]byte(textMsg), &doneSignal); jsonErr == nil && doneSignal.Done {
					if doneSignal.FileChecksum != "" {
						computedSum := fileCRC32Hasher.Sum32()
						computedSumBytes := []byte{byte(computedSum >> 24), byte(computedSum >> 16), byte(computedSum >> 8), byte(computedSum)}
						computedHex := hex.EncodeToString(computedSumBytes)
						if doneSignal.FileChecksum != computedHex {
							return errors.New("File integrity check failed")
						}
					}
					break
				}

				var meta struct {
					Index    int    `json:"index"`
					Checksum string `json:"checksum"`
				}
				if jsonErr := json.Unmarshal([]byte(textMsg), &meta); jsonErr != nil {
					return errors.New("Invalid chunk metadata received")
				}
				pendingChunkIndex = meta.Index
				pendingChunkChecksum = meta.Checksum
				expectingBinary = true
			}
		} else if mt == 2 {
			if !expectingBinary {
				return errors.New("Received chunk without metadata")
			}
			expectingBinary = false

			chunkSum := crc32.ChecksumIEEE(message)
			chunkSumBytes := []byte{byte(chunkSum >> 24), byte(chunkSum >> 16), byte(chunkSum >> 8), byte(chunkSum)}
			chunkHex := hex.EncodeToString(chunkSumBytes)
			if pendingChunkChecksum != "" && pendingChunkChecksum != chunkHex {
				retryMsg, _ := json.Marshal(map[string]int{"retryChunk": pendingChunkIndex})
				c.WriteMessage(1, retryMsg)
				continue
			}

			chunkFilepath := filepath.Join(uploadFolder, "upld_"+strconv.Itoa(pendingChunkIndex))
			if pendingChunkIndex == blockCounter {
				chunkName = append(chunkName, chunkFilepath)
				blockCounter++
			}

			if err := os.WriteFile(chunkFilepath, message, 0700); err != nil {
				return errors.New("Write file chunk to disk failed")
			}

			fileCRC32Hasher.Write(message)
			lastChunkArrivalTime = time.Now().Unix()
			totalFileSize += int64(len(message))
			if totalFileSize > expectedSize {
				return errors.New("File size exceeds declared upload size")
			}
			c.WriteMessage(1, []byte("next"))
		}
	}

	if totalFileSize != expectedSize {
		return errors.New("File size does not match declared upload size")
	}

	manifest, _ := json.Marshal(chunkName)
	return os.WriteFile(filepath.Join(uploadFolder, "manifest.json"), manifest, 0600)
}

func mergeUploadLinkChunks(uploadFolder string, destPath string, targetFsh *filesystem.FileSystemHandler) error {
	manifestBytes, err := os.ReadFile(filepath.Join(uploadFolder, "manifest.json"))
	if err != nil {
		return err
	}
	chunkName := []string{}
	if err := json.Unmarshal(manifestBytes, &chunkName); err != nil {
		return err
	}

	targetFs := targetFsh.FileSystemAbstraction
	if targetFsh.RequireBuffer {
		mergeFileLocation := filepath.Join(uploadFolder, "merged")
		out, err := os.OpenFile(mergeFileLocation, os.O_CREATE|os.O_WRONLY, 0755)
		if err != nil {
			return err
		}
		for _, filesrc := range chunkName {
			srcChunkReader, err := os.Open(filesrc)
			if err != nil {
				out.Close()
				return err
			}
			if _, err := io.Copy(out, srcChunkReader); err != nil {
				srcChunkReader.Close()
				out.Close()
				return err
			}
			srcChunkReader.Close()
		}
		out.Close()

		f, err := os.Open(mergeFileLocation)
		if err != nil {
			return err
		}
		defer f.Close()
		return targetFs.WriteStream(destPath, f, 0775)
	}

	out, err := targetFs.OpenFile(destPath, os.O_CREATE|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	defer out.Close()
	for _, filesrc := range chunkName {
		srcChunkReader, err := os.Open(filesrc)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, srcChunkReader); err != nil {
			srcChunkReader.Close()
			return err
		}
		srcChunkReader.Close()
	}
	return nil
}

func (s *Manager) prepareUploadLinkUpload(linkUUID string, filename string, uploadSize int64) (*uploadContext, error) {
	table, err := s.getUploadLinkTable()
	if err != nil {
		return nil, err
	}
	link := table.GetUploadLinkFromUUID(linkUUID)
	if link == nil {
		return nil, errors.New("Upload link not exists")
	}
	if !link.IsActive(time.Now().Unix()) {
		return nil, errors.New("Upload link expired or disabled")
	}

	owner, err := s.options.UserHandler.GetUserInfoFromUsername(link.Owner)
	if err != nil {
		return nil, errors.New("Upload link owner not exists")
	}
	targetFsh, realUploadPath, err := s.validateUploadLinkTarget(owner, link.TargetVirtualPath)
	if err != nil {
		return nil, err
	}

	filename = strings.TrimSpace(filename)
	if filename == "" || filename == "." || arozfs.Base(filename) != filename || !utils.FilenameIsWebSafe(filename) {
		return nil, errors.New("Invalid filename given")
	}

	ownerRemainingQuota := getOwnerRemainingQuota(owner)
	if err := table.ReserveUpload(link.UUID, uploadSize, time.Now().Unix(), s.options.MaxUploadSize, ownerRemainingQuota); err != nil {
		return nil, err
	}

	destPath, releaseName, err := s.reserveAnonymousUploadDestination(targetFsh.FileSystemAbstraction, realUploadPath, filename)
	if err != nil {
		table.ReleaseUpload(link.UUID, uploadSize)
		return nil, err
	}

	return &uploadContext{
		Link:        link,
		Owner:       owner,
		TargetFsh:   targetFsh,
		TargetDir:   realUploadPath,
		DestPath:    destPath,
		UploadSize:  uploadSize,
		releaseName: releaseName,
	}, nil
}

func (s *Manager) completeUploadLinkUpload(ctx *uploadContext, uploadSize int64) error {
	if ctx == nil || ctx.Link == nil {
		return errors.New("Invalid upload context")
	}
	if _, _, err := s.validateUploadLinkTarget(ctx.Owner, ctx.Link.TargetVirtualPath); err != nil {
		s.options.UploadLinkTable.ReleaseUpload(ctx.Link.UUID, ctx.UploadSize)
		return err
	}
	if err := s.options.UploadLinkTable.CommitUpload(ctx.Link.UUID, uploadSize); err != nil {
		return err
	}
	if ctx.TargetFsh.Hierarchy == "user" {
		ctx.Owner.StorageQuota.AllocateSpace(uploadSize)
	}
	return nil
}

func (s *Manager) validateUploadLinkTarget(userinfo *user.User, vpath string) (*filesystem.FileSystemHandler, string, error) {
	if userinfo == nil {
		return nil, "", errors.New("User not logged in")
	}
	if strings.TrimSpace(vpath) == "" {
		return nil, "", errors.New("Invalid path given")
	}
	if !userinfo.CanWrite(vpath) {
		return nil, "", errors.New("Access Denied")
	}
	fsh := userinfo.GetRootFSHFromVpathInUserScope(vpath)
	if fsh == nil {
		return nil, "", errors.New("Invalid path given")
	}
	if fsh.ReadOnly {
		return nil, "", errors.New("The upload target is Read Only.")
	}
	realPath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, userinfo.Username)
	if err != nil {
		return nil, "", errors.New("Upload target is invalid or permission denied.")
	}
	if !fsh.FileSystemAbstraction.FileExists(realPath) {
		return nil, "", errors.New("Folder not exists")
	}
	if !fsh.FileSystemAbstraction.IsDir(realPath) {
		return nil, "", errors.New("Upload link target must be a folder")
	}
	return fsh, realPath, nil
}

func (s *Manager) reserveAnonymousUploadDestination(targetFs filesystem.FileSystemAbstraction, realUploadPath string, filename string) (string, func(), error) {
	stem := strings.TrimSuffix(filename, filepath.Ext(filename))
	ext := filepath.Ext(filename)
	timestamp := time.Now().Format("20060102-150405")

	s.uploadNameMu.Lock()
	defer s.uploadNameMu.Unlock()

	for i := 0; i <= 1024; i++ {
		candidate := filename
		if i == 0 {
			originalPath := filepath.Join(realUploadPath, candidate)
			originalKey := filepath.ToSlash(filepath.Clean(originalPath))
			if !targetFs.FileExists(originalPath) && !s.uploadReservedNames[originalKey] {
				s.uploadReservedNames[originalKey] = true
				return originalPath, func() {
					s.uploadNameMu.Lock()
					delete(s.uploadReservedNames, originalKey)
					s.uploadNameMu.Unlock()
				}, nil
			}
			candidate = stem + "_" + timestamp + ext
		} else {
			candidate = stem + "_" + timestamp + "_" + strconv.Itoa(i) + ext
		}
		targetPath := filepath.Join(realUploadPath, candidate)
		key := filepath.ToSlash(filepath.Clean(targetPath))
		if !targetFs.FileExists(targetPath) && !s.uploadReservedNames[key] {
			s.uploadReservedNames[key] = true
			return targetPath, func() {
				s.uploadNameMu.Lock()
				delete(s.uploadReservedNames, key)
				s.uploadNameMu.Unlock()
			}, nil
		}
	}
	return "", func() {}, errors.New("Too many files with identical names")
}

func (s *Manager) maxPublicUploadBodySize(linkUUID string) (int64, error) {
	table, err := s.getUploadLinkTable()
	if err != nil {
		return 0, err
	}
	link := table.GetUploadLinkFromUUID(linkUUID)
	if link == nil || !link.IsActive(time.Now().Unix()) {
		return 0, errors.New("Upload link expired or disabled")
	}
	owner, err := s.options.UserHandler.GetUserInfoFromUsername(link.Owner)
	if err != nil {
		return 0, errors.New("Upload link owner not exists")
	}
	remainingQuota := getOwnerRemainingQuota(owner)
	remainingLinkBytes := remainingUploadBytes(link)
	maxBodySize := minPositiveInt64(link.MaxFileSize, remainingLinkBytes)
	if s.options.MaxUploadSize > 0 {
		maxBodySize = minPositiveInt64(maxBodySize, s.options.MaxUploadSize)
	}
	if remainingQuota >= 0 {
		maxBodySize = minPositiveInt64(maxBodySize, remainingQuota)
	}
	if maxBodySize <= 0 {
		return 0, errors.New("Upload link has no remaining quota")
	}
	return maxBodySize, nil
}

func (s *Manager) getUploadLinkTable() (*shareEntry.UploadLinkTable, error) {
	if s.options.UploadLinkTable == nil {
		return nil, errors.New("Upload link manager not initialized")
	}
	return s.options.UploadLinkTable, nil
}

func (s *Manager) canModifyUploadLink(userinfo *user.User, link *shareEntry.UploadLinkOption) bool {
	if userinfo == nil || link == nil {
		return false
	}
	if userinfo.IsAdmin() || userinfo.Username == link.Owner {
		return true
	}
	return false
}

func (s *Manager) normalizeUploadLinkLimits(owner *user.User, maxFileCount int64, maxFileSize int64, maxTotalSize int64) (int64, int64, int64, error) {
	if maxFileCount <= 0 {
		maxFileCount = defaultUploadLinkMaxFileCount
	}
	if maxFileSize <= 0 {
		maxFileSize = defaultUploadLinkMaxFileSize
	}
	if maxTotalSize <= 0 {
		maxTotalSize = defaultUploadLinkMaxTotalSize
	}

	if s.options.MaxUploadSize > 0 && maxFileSize > s.options.MaxUploadSize {
		maxFileSize = s.options.MaxUploadSize
	}

	remainingQuota := getOwnerRemainingQuota(owner)
	if remainingQuota == 0 {
		return 0, 0, 0, errors.New("User Storage Quota Exceeded")
	}
	if remainingQuota > 0 {
		if maxTotalSize > remainingQuota {
			maxTotalSize = remainingQuota
		}
		if maxFileSize > remainingQuota {
			maxFileSize = remainingQuota
		}
	}
	if maxTotalSize > 0 && maxFileSize > maxTotalSize {
		maxFileSize = maxTotalSize
	}
	if maxFileSize <= 0 || maxTotalSize <= 0 {
		return 0, 0, 0, errors.New("User Storage Quota Exceeded")
	}

	return maxFileCount, maxFileSize, maxTotalSize, nil
}

func (s *Manager) toUploadLinkResponse(link *shareEntry.UploadLinkOption, r *http.Request) uploadLinkResponse {
	return uploadLinkResponse{
		UUID:               link.UUID,
		TargetVirtualPath:  link.TargetVirtualPath,
		Owner:              link.Owner,
		CreatedUnix:        link.CreatedUnix,
		ExpiresUnix:        link.ExpiresUnix,
		MaxFileCount:       link.MaxFileCount,
		MaxFileSize:        link.MaxFileSize,
		MaxTotalSize:       link.MaxTotalSize,
		UploadedFileCount:  link.UploadedFileCount,
		UploadedBytes:      link.UploadedBytes,
		Disabled:           link.Disabled,
		RemainingFileCount: remainingUploadFileCount(link),
		RemainingBytes:     remainingUploadBytes(link),
		URL:                getRequestBaseURL(r) + "/share/upload/" + link.UUID,
	}
}

func getOwnerRemainingQuota(owner *user.User) int64 {
	if owner == nil || owner.StorageQuota == nil {
		return 0
	}
	if owner.StorageQuota.TotalStorageQuota == -1 {
		return -1
	}
	remaining := owner.StorageQuota.TotalStorageQuota - owner.StorageQuota.UsedStorageQuota
	if remaining < 0 {
		return 0
	}
	return remaining
}

func remainingUploadFileCount(link *shareEntry.UploadLinkOption) int64 {
	if link.MaxFileCount <= 0 {
		return -1
	}
	remaining := link.MaxFileCount - link.UploadedFileCount
	if remaining < 0 {
		return 0
	}
	return remaining
}

func remainingUploadBytes(link *shareEntry.UploadLinkOption) int64 {
	if link.MaxTotalSize <= 0 {
		return -1
	}
	remaining := link.MaxTotalSize - link.UploadedBytes
	if remaining < 0 {
		return 0
	}
	return remaining
}

func parseInt64FormDefault(r *http.Request, key string, fallback int64) int64 {
	raw := strings.TrimSpace(r.Form.Get(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	return value
}

func minPositiveInt64(values ...int64) int64 {
	result := int64(0)
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if result == 0 || value < result {
			result = value
		}
	}
	return result
}

func getRequestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwardedProto := r.Header.Get("X-Forwarded-Proto"); forwardedProto != "" {
		scheme = strings.Split(forwardedProto, ",")[0]
	}
	return scheme + "://" + r.Host
}

func escapeJSONError(message string) string {
	encoded, _ := json.Marshal(message)
	trimmed := strings.TrimPrefix(string(encoded), `"`)
	trimmed = strings.TrimSuffix(trimmed, `"`)
	return trimmed
}
