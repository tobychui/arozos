package fileservers

import "imuslab.com/arozos/mod/info/logger"

/*
	File Server

	This module handle the functions related to file server managements
*/

// Utilities
func GetFileServerById(servers []*Server, id string) (out0 *Server) {
	defer logger.Out1(logger.In2("fileservers", "GetFileServerById", "servers", servers, "id", id), &out0)
	for _, server := range servers {
		if server.ID == id {
			return server
		}
	}

	return nil
}
