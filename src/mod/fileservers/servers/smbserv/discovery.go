package smbserv

import (
	"crypto/sha256"
	"fmt"
	"runtime"

	"github.com/grandcat/zeroconf"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/wsd"
)

/*
	discovery.go

	Makes the server show up by itself: in the Network view of Windows
	Explorer through WS-Discovery (with LLMNR for the name it lists), and in
	the macOS Finder sidebar through an _smb._tcp mDNS service. Both run only
	while the server does, and an admin can turn them off.
*/

type announcer struct {
	wsd  *wsd.Responder
	mdns []*zeroconf.Server
}

// discoverable is the admin setting, on by default.
func (m *Manager) discoverable() bool {
	on := true
	if m.opt.Sysdb.KeyExists(settingsTable, "discover") {
		m.opt.Sysdb.Read(settingsTable, "discover", &on)
	}
	return on
}

// discoveryUUID is the device id Windows remembers this computer by. It must
// not change between restarts, or Explorer lists the computer twice.
func (m *Manager) discoveryUUID() string {
	sum := sha256.Sum256([]byte("arozos-wsd-" + m.opt.DeviceID))
	sum[6] = sum[6]&0x0f | 0x50
	sum[8] = sum[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[0:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

// announce starts what the settings allow. Nothing here stops the server
// from running: a port another program holds is logged and left out.
func (m *Manager) announce(port int) *announcer {
	if !m.discoverable() {
		return nil
	}
	a := &announcer{}
	//The Network view opens \\NAME on port 445 and knows no other port.
	//A Windows host announces itself already.
	if port == DefaultPort && runtime.GOOS != "windows" && !m.opt.NoWSD {
		r, err := wsd.Start(wsd.Config{Name: m.opt.ServerName, Workgroup: "WORKGROUP", UUID: m.discoveryUUID()})
		if err != nil {
			logger.PrintAndLog(logTitle, "Could not join the Windows Network view", err)
		} else {
			a.wsd = r
		}
	}
	if m.opt.AllowMDNS {
		name := m.opt.DisplayName
		if name == "" {
			name = m.opt.ServerName
		}
		if s, err := zeroconf.Register(name, "_smb._tcp", "local.", port, nil, nil); err == nil {
			a.mdns = append(a.mdns, s)
		} else {
			logger.PrintAndLog(logTitle, "Could not announce SMB over mDNS", err)
		}
		//The icon Finder shows for the computer
		if s, err := zeroconf.Register(name, "_device-info._tcp", "local.", 0, []string{"model=RackMac"}, nil); err == nil {
			a.mdns = append(a.mdns, s)
		}
	}
	return a
}

func (a *announcer) stop() {
	if a == nil {
		return
	}
	if a.wsd != nil {
		a.wsd.Close()
	}
	for _, s := range a.mdns {
		s.Shutdown()
	}
}
