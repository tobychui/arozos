package fileservers

import "imuslab.com/arozos/mod/info/logger"

/*
	File Server

	This module handle the functions related to file server managements
*/

// Utilities
func GetFileServerById(servers []*Server, id string) *Server {
	if logger.IsDebug() {
		logger.Debugf("fileservers", "GetFileServerById: len(servers)=%d id=%.120q", len(servers), id)
	}
	for _, server := range servers {
		if server.ID == id {
			return server
		}
	}

	return nil
}
