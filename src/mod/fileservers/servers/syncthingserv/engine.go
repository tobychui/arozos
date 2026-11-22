package syncthingserv

import "time"

/*
	Engine

	The embedded Syncthing instance, behind an interface so the manager can be
	tested without it. engine_syncthing.go has the real one; on platforms the
	Syncthing database cannot be built for, newEngine stays nil and the file
	server is left out of the list.
*/

// DefaultPort is Syncthing's own default for sync connections
const DefaultPort = 22000

// newEngine is set by engine_syncthing.go where Syncthing is built in.
var newEngine func() engine

// qrCode draws text as a PNG QR code, set beside newEngine.
var qrCode func(text string) ([]byte, error)

// Available reports whether this build carries Syncthing.
func Available() bool {
	return newEngine != nil
}

type engineConfig struct {
	Dir      string //Keys, configuration and index of the server device
	Name     string //Device name the phones see
	Settings Settings
}

type engine interface {
	//Start runs Syncthing with the given plan already applied
	Start(cfg engineConfig, p plan) error
	Stop()
	//Apply replaces the devices and folders, and the network settings
	Apply(cfg engineConfig, p plan) error
	//DeviceID is the server's device ID, "" while stopped
	DeviceID() string
	//ParseDeviceID checks a device ID and returns it in its usual form
	ParseDeviceID(s string) (string, error)
	FolderStatus(id string) FolderStatus
	DeviceStatus(id string) DeviceStatus
	//Offers lists the folders a device wants to share with the server
	Offers(deviceID string) []Offer
	Rescan(folderID string) error
	//RestartFolder stops a folder and starts it again, like pausing and
	//resuming it, which gives up the requests a device never answered
	RestartFolder(folderID string) error
	//LocalBytes is the size of a folder as Syncthing counts it
	LocalBytes(folderID string) (int64, bool)
	//UnknownDevices tried to connect but nobody added them
	UnknownDevices() []UnknownDevice
}

// FolderStatus is what Syncthing reports about a folder.
type FolderStatus struct {
	State       string //idle, scanning, syncing, error, paused, ... or "" when unknown
	Error       string
	LocalFiles  int
	LocalBytes  int64
	GlobalFiles int
	GlobalBytes int64
	NeedFiles   int
	NeedBytes   int64
	PulledBytes int64 //What arrived of the files being pulled right now
	Changed     time.Time
}

// DeviceStatus is what Syncthing reports about a device.
type DeviceStatus struct {
	Connected bool
	LastSeen  time.Time
}

// Offer is a folder a device shares with the server.
type Offer struct {
	FolderID string
	Label    string
	Time     time.Time
}

// UnknownDevice tried to connect without being added by anyone.
type UnknownDevice struct {
	ID      string
	Name    string
	Address string
	Time    time.Time
}
