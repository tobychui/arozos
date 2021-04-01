package iot

/*
	ArozOS IoT Handler

	This handler provide adaptive functions to different protocol based IoT devices
	(aka this is just a wrapper class. See independent IoT module for more information)
*/

//Defination of a control endpoint
type Endpoint struct {
	RelPath string //Relative path for this endpoint. If the access path is 192.168.0.100:8080/api1, then this value should be /api1
	Name    string //Name of the this endpoint. E.g. "Toggle Light"
	Desc    string //Description of function. E.g. "Toggle the ligh on and off"
	Type    string //Type of endpoint data. Accept {string, integer, float, bool, none}

	//Filter for string type inputs
	Regex string

	//Filter for integer and float type inputs
	Min   float64
	Max   float64
	Steps float64
}

//Defination of an IoT device
type Device struct {
	Name         string //Name of the device
	Port         int    //The communication port on the device. -1 for N/A
	Model        string //Model number of the device
	Version      string //Device firmware
	Manufacturer string //<amifacturer of device
	DeviceUUID   string //Device UUID

	IPAddr           string                 //IP address of the device
	RequireAuth      bool                   //Require authentication or public accessable.
	RequireConnect   bool                   //Require pre-connection before use
	Status           map[string]interface{} //Status of the device, support multi channels
	ControlEndpoints []*Endpoint            //Endpoints avabile for this device
	Handler          ProtocolHandler        //Its parent protocol handler
}

type AuthInfo struct {
	Username string
	Password string
	Token    string
}

type Stats struct {
	Name          string //Name of the protocol handler (e.g. Home Dynamic v2)
	Desc          string //Description of the protcol
	Version       string //Version of the handler (recommend matching the protocol ver for easier maintaince)
	ProtocolVer   string //Version of the hardware protocol
	Author        string //Name of the author
	AuthorWebsite string //Author contact website
	AuthorEmail   string //Author Email
	ReleaseDate   int64  //Release Date in unix timestamp
}

var (
	NoAuth AuthInfo = AuthInfo{} //Empty struct for quick no auth IoT protocols
)

type ProtocolHandler interface {
	Start() error                                                                         //Run Startup check. This IoT Protocl Handler will not load if this return any error (e.g. required wireless hardware not found) **TRY NOT TO USE BLOCKING LOGIC HERE**
	Scan() ([]*Device, error)                                                             //Scan the nearby devices                                                        //Return the previous scanned list
	Connect(device *Device, authInfo *AuthInfo) error                                     //Connect to the device
	Status(device *Device) (map[string]interface{}, error)                                //Get status of the IoT device
	Execute(device *Device, endpoint *Endpoint, payload interface{}) (interface{}, error) //Execute an endpoint for a device
	Disconnect(device *Device) error                                                      //Disconnect from a device connection
	Stats() Stats                                                                         //Return the properties and status of the Protocol Handler
	Icon(device *Device) string                                                           //Get the icon of the device, see iot/hub/img/devices for a list of icons
}
