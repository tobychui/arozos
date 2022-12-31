package fileservers

/*
	File Server

	This module handle the functions related to file server managements
*/

//Utilities
func GetFileServerById(servers []*Server, id string) *Server {
	for _, server := range servers {
		if server.ID == id {
			return server
		}
	}

	return nil
}
