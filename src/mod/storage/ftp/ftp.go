package ftp

import (
	"errors"
	"log"
	"strconv"
	"sync"

	ftp "github.com/fclairamb/ftpserverlib"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/user"
)

//Handler is the handler for the FTP server defined in arozos
type Handler struct {
	ServerName    string
	Port          int
	ServerRunning bool
	UPNPEnabled   bool
	userHandler   *user.UserHandler
	server        *ftp.FtpServer
}

type mainDriver struct {
	setting           ftp.Settings
	userHandler       *user.UserHandler
	tmpFolder         string
	connectedUserList *sync.Map
}

//NewFTPHandler creates a new handler for FTP Server as a wrapper to the ftpserverlib
func NewFTPHandler(userHandler *user.UserHandler, ServerName string, Port int, tmpFolder string) (*Handler, error) {
	//Create table for ftp if it doesn't exists
	db := userHandler.GetDatabase()
	db.NewTable("ftp")

	//Create a new FTP Server instance
	server := ftp.NewFtpServer(&mainDriver{
		setting: ftp.Settings{
			ListenAddr: ":" + strconv.Itoa(Port),
			PassiveTransferPortRange: &ftp.PortRange{
				Start: 12810,
				End:   12910,
			},
		},
		userHandler:       userHandler,
		tmpFolder:         tmpFolder,
		connectedUserList: &sync.Map{},
	})
	return &Handler{
		ServerName:    ServerName,
		Port:          Port,
		ServerRunning: false,
		userHandler:   userHandler,
		UPNPEnabled:   false,
		server:        server,
	}, nil
}

//Update which usergroups can access the file system via ftp server
func UpdateAccessableGroups(database *database.Database, groups []string) {
	database.Write("ftp", "groups", groups)
	if len(groups) == 0 {
		log.Println("Setting no group access to ftp server!")
	}
}

//ListenAndServe Start Listen and Serve
func (f *Handler) Start() error {
	if f.server != nil {
		go func(f *Handler) {
			log.Println("FTP Server Started, listening at: " + strconv.Itoa(f.Port))
			f.server.ListenAndServe()
		}(f)
		f.ServerRunning = true
		return nil
	} else {
		return errors.New("FTP server not initiated")
	}
}

//Close the FTP Server
func (f *Handler) Close() {
	if f.server != nil {
		f.server.Stop()
		f.ServerRunning = false
	}
}
