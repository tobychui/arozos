package fileservers

/*
	Type defination of fileserver Manager
*/

import user "imuslab.com/arozos/mod/user"

type Endpoint struct {
	ProtocolName string //Protocol name of the endpoint, e.g. ftp
	Port         int    //Port for the endpoint, e.g. 21
	Subpath      string //Subpath of the endpoint, e.g. /webdav/user
}

type Server struct {
	ID                string //ID of the File Server Type
	Name              string //Name of the File Server Type. E.g. FTP
	Desc              string //Description of the File Server Type, e.g. File Transfer Protocol
	IconPath          string //Path for the protocol Icon, if any
	DefaultPorts      []int  //Default ports aquire by the Server. Override by Ports if set
	Ports             []int  //Ports required by the File Server Type that might need port forward. e.g. 21, 22
	ForwardPortIfUpnp bool   //Forward the port if UPnP is enabled
	ConnInstrPage     string //Connection instruction page, visable by all users
	ConfigPage        string //Config page for changing settings of this File Server Type, admin only

	//Generic operation endpoints
	EnableCheck  func() bool                  `json:"-"` //Return the status of if the server is currently runnign
	ToggleFunc   func(bool) error             `json:"-"` //Toggle on/off of this service
	GetEndpoints func(*user.User) []*Endpoint `json:"-"` //Get the accessible endpoints for this user
}
