package tftp

import (
	"errors"
	"io"
	"log"
	"strconv"
	"sync"
	"time"

	tftplib "github.com/pin/tftp/v3"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/user"
)

const (
	// Maximum file size allowed for TFTP transfer (32MB)
	MAX_FILE_SIZE = 32 * 1024 * 1024
)

// Handler is the handler for the TFTP server defined in arozos
type Handler struct {
	ServerName    string
	Port          int
	ServerRunning bool
	userHandler   *user.UserHandler
	server        *tftplib.Server
	cancelFunc    func()
}

type tftpDriver struct {
	userHandler       *user.UserHandler
	tmpFolder         string
	connectedUserList *sync.Map
	db                *database.Database
}

// NewTFTPHandler creates a new handler for TFTP Server
func NewTFTPHandler(userHandler *user.UserHandler, ServerName string, Port int, tmpFolder string) (*Handler, error) {
	//Create table for tftp if it doesn't exists
	db := userHandler.GetDatabase()
	db.NewTable("tftp")

	driver := &tftpDriver{
		userHandler:       userHandler,
		tmpFolder:         tmpFolder,
		connectedUserList: &sync.Map{},
		db:                db,
	}

	// Create a new TFTP Server instance
	server := tftplib.NewServer(driver.readHandler, driver.writeHandler)
	server.SetTimeout(5 * time.Second)

	return &Handler{
		ServerName:    ServerName,
		Port:          Port,
		ServerRunning: false,
		userHandler:   userHandler,
		server:        server,
	}, nil
}

// Start the TFTP Server
func (h *Handler) Start() error {
	if h.server != nil {
		addr := ":" + strconv.Itoa(h.Port)
		log.Println("[TFTP] Server Started, listening at: " + strconv.Itoa(h.Port))

		go func() {
			err := h.server.ListenAndServe(addr)
			if err != nil {
				log.Println("[TFTP] Server error:", err)
			}
		}()

		h.ServerRunning = true
		return nil
	} else {
		return errors.New("TFTP server not initiated")
	}
}

// Close the TFTP Server
func (h *Handler) Close() {
	if h.server != nil {
		h.server.Shutdown()
		h.ServerRunning = false
	}
}

// readHandler handles TFTP read requests (GET)
func (d *tftpDriver) readHandler(filename string, rf io.ReaderFrom) error {
	// Get default user for TFTP access
	// Since TFTP doesn't have authentication, we use a configured default user
	username := ""
	if d.db.KeyExists("tftp", "defaultUser") {
		d.db.Read("tftp", "defaultUser", &username)
	}

	if username == "" {
		return errors.New("no default user configured for TFTP access")
	}

	// Get user info
	userinfo, err := d.userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return errors.New("default user not found")
	}

	// Create arozfs adapter
	afs := &aofs{
		userinfo:  userinfo,
		tmpFolder: d.tmpFolder,
	}

	// Open file for reading
	file, err := afs.Open(filename)
	if err != nil {
		log.Printf("[TFTP] READ: Failed to open %s: %v", filename, err)
		return err
	}
	defer file.Close()

	// Get file info
	fileInfo, err := file.Stat()
	if err != nil {
		return err
	}

	// TFTP has a size limit (typically for smaller files)
	// We'll allow up to 32MB
	if fileInfo.Size() > MAX_FILE_SIZE {
		return errors.New("file too large for TFTP transfer")
	}

	n, err := rf.ReadFrom(file)
	if err != nil {
		log.Printf("[TFTP] READ: Transfer error for %s: %v", filename, err)
		return err
	}

	log.Printf("[TFTP] READ: Sent %s (%d bytes)", filename, n)
	return nil
}

// writeHandler handles TFTP write requests (PUT)
func (d *tftpDriver) writeHandler(filename string, wt io.WriterTo) error {
	// Get default user for TFTP access
	username := ""
	if d.db.KeyExists("tftp", "defaultUser") {
		d.db.Read("tftp", "defaultUser", &username)
	}

	if username == "" {
		return errors.New("no default user configured for TFTP access")
	}

	// Get user info
	userinfo, err := d.userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return errors.New("default user not found")
	}

	// Create arozfs adapter
	afs := &aofs{
		userinfo:  userinfo,
		tmpFolder: d.tmpFolder,
	}

	// Check if user can write
	file, err := afs.Create(filename)
	if err != nil {
		log.Printf("[TFTP] WRITE: Failed to create %s: %v", filename, err)
		return err
	}
	defer file.Close()

	n, err := wt.WriteTo(file)
	if err != nil {
		log.Printf("[TFTP] WRITE: Transfer error for %s: %v", filename, err)
		return err
	}

	log.Printf("[TFTP] WRITE: Received %s (%d bytes)", filename, n)
	return nil
}
