package nfsserv

import (
	"fmt"
	"net"

	nfs "github.com/willscott/go-nfs"
	"imuslab.com/arozos/mod/permission"
)

type Option struct {
	ListeningPort    int
	AllowAccessGroup *permission.PermissionGroup
}

type Instance struct {
	server    *nfs.Server
	isRunning bool
	option    *Option
}

// Create a new NFS Server
func NewNfsServer(option Option) (*Instance, error) {
	// Check if the listening port is free and not occupied by another application
	l, err := net.Listen("tcp", fmt.Sprintf(":%d", option.ListeningPort))
	if err != nil {
		return nil, err
	}
	l.Close()

	return &Instance{
		server:    nil,
		isRunning: false,
		option:    &option,
	}, nil
}
