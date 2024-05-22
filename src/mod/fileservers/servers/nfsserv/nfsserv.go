package nfsserv

import (
	"fmt"
	"net"
	"strconv"

	"github.com/smallfz/libnfs-go/backend"
	"github.com/smallfz/libnfs-go/memfs"
	server "github.com/smallfz/libnfs-go/server"
	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/user"
)

type Option struct {
	UserManager      *user.UserHandler
	ListeningPort    int
	AllowAccessGroup []*permission.PermissionGroup
	Logger           *logger.Logger
}

type Manager struct {
	server      *server.Server //NFS server
	tcpListener net.Listener   //Underlaying TCP connection lisener
	isRunning   bool
	Option      *Option
}

// Create a new NFS Server
func NewNfsServer(option Option) *Manager {
	if option.Logger == nil {
		//Create a new one
		option.Logger, _ = logger.NewTmpLogger()
	}

	return &Manager{
		server:    nil,
		isRunning: false,
		Option:    &option,
	}
}

// Interfaces required for registering File Server in ArozOS
func (s *Manager) IsRunning() bool {
	return s.isRunning
}

func (s *Manager) GetEndpoints(userinfo *user.User) []*fileservers.Endpoint {
	eps := []*fileservers.Endpoint{}
	eps = append(eps, &fileservers.Endpoint{
		ProtocolName: "\\\\",
		Port:         s.Option.ListeningPort,
		Subpath:      "",
	})
	return eps
}

func (s *Manager) ServerToggle(enabled bool) error {
	if s.isRunning {
		return s.Stop()
	} else {
		return s.Start()
	}
}

// Wrapper for logger PrintAndLog
func (s *Manager) Log(message string, err error) {
	s.Option.Logger.PrintAndLog("NFS", message, err)
}

// TODO: Link this to arozfs
func (s *Manager) Start() error {
	mfs := memfs.NewMemFS()
	backend := backend.New(mfs)
	svr, err := server.NewServerTCP(":"+strconv.Itoa(s.Option.ListeningPort), backend)
	if err != nil {
		s.Log("failed to start NFS Server", err)
		return err
	}
	s.Log("Server started listening on "+":"+strconv.Itoa(s.Option.ListeningPort), nil)
	s.server = svr
	s.isRunning = true
	go func() {
		if err := svr.Serve(); err != nil {
			fmt.Printf("svr.Serve: %v\n", err)
		}
	}()
	return nil
}

func (s *Manager) Stop() error {

	return nil
}
