package smbserv

import (
	"crypto/sha256"
	"fmt"
	"net"
	"os"
	"runtime"
	"strings"

	"github.com/grandcat/zeroconf"
	"github.com/tobychui/smbsrv/wsd"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/aroz"
)

/*
	discovery.go

	Makes the server show up by itself: in the Network view of Windows
	Explorer through WS-Discovery (with LLMNR for the name it lists), and in
	the macOS Finder sidebar through an _smb._tcp mDNS service. Both run only
	while the server does, and an admin can turn them off.

	With macOS support on and a user's drive picked for backups, an _adisk
	service also tells Macs that the TimeMachine share takes Time Machine
	backups, so it is listed under Add Backup Disk.
*/

type announcer struct {
	wsd  *wsd.Responder
	mdns []*zeroconf.Server

	//The Time Machine record, and the name it is announced under: it comes
	//and goes as users pick drives, while the rest stays
	adisk    *zeroconf.Server
	mdnsName string
}

// discoverable is the admin setting, on by default.
func (m *Manager) discoverable() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.discoverable", "m", m), &out0)
	on := true
	if m.opt.Sysdb.KeyExists(settingsTable, "discover") {
		m.opt.Sysdb.Read(settingsTable, "discover", &on)
	}
	return on
}

// discoveryUUID is the device id Windows remembers this computer by. It must
// not change between restarts, or Explorer lists the computer twice.
func (m *Manager) discoveryUUID() (out0 string) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.discoveryUUID", "m", m), &out0)
	sum := sha256.Sum256([]byte("arozos-wsd-" + m.opt.DeviceID))
	sum[6] = sum[6]&0x0f | 0x50
	sum[8] = sum[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[0:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

// announce starts what the settings allow. Nothing here stops the server
// from running: a port another program holds is logged and left out.
func (m *Manager) announce(port int) (out0 *announcer) {
	defer logger.Out1(logger.In2("fileservers/servers/smbserv", "Manager.announce", "m", m, "port", port), &out0)
	if !m.discoverable() {
		return nil
	}
	a := &announcer{}
	//The Network view opens \\NAME on port 445 and knows no other port.
	//A Windows host announces itself already.
	if port == DefaultPort && runtime.GOOS != "windows" && !m.opt.NoWSD {
		r, err := wsd.Start(wsd.Config{
			Name:         m.opt.ServerName,
			Workgroup:    "WORKGROUP",
			UUID:         m.discoveryUUID(),
			Manufacturer: "ArozOS",
			Model:        "ArozOS",
			Logger:       logger.NewSlog("WSD"),
		})
		if err != nil {
			logger.DebugErr("fileservers/servers/smbserv", err)
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
		if s, err := registerMDNS(name, "_smb._tcp", port, nil); err == nil {
			a.mdns = append(a.mdns, s)
		} else {
			logger.PrintAndLog(logTitle, "Could not announce SMB over mDNS", err)
		}
		//The icon Finder shows for the computer. Macs only read the TXT, and
		//zeroconf refuses port 0, so the record names the discard port
		if s, err := registerMDNS(name, "_device-info._tcp", 9, []string{"model=RackMac"}); err == nil {
			a.mdns = append(a.mdns, s)
		}
		a.mdnsName = name
		if m.wantTimeMachineAnnouncement() {
			a.adisk = registerTimeMachine(name)
		}
	}
	return a
}

func (a *announcer) stop() {
	defer logger.Out0(logger.In1("fileservers/servers/smbserv", "announcer.stop", "a", a))
	if a == nil {
		return
	}
	if a.wsd != nil {
		a.wsd.Close()
	}
	for _, s := range a.mdns {
		s.Shutdown()
	}
	if a.adisk != nil {
		a.adisk.Shutdown()
	}
}

// timeMachineRecords is the TXT of the _adisk service, as Samba writes it:
// system flags, then one disk, the TimeMachine share, whose flags 0x82 say
// it takes Time Machine backups over SMB.
func timeMachineRecords() (out0 []string) {
	defer logger.Out1(logger.In0("fileservers/servers/smbserv", "timeMachineRecords"), &out0)
	return []string{"sys=adVF=0x100", "dk0=adVN=" + aroz.TimeMachineShareName + ",adVF=0x82"}
}

// wantTimeMachineAnnouncement reports whether any Mac could back up here.
func (m *Manager) wantTimeMachineAnnouncement() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "Manager.wantTimeMachineAnnouncement", "m", m), &out0)
	return m.appleOn() && m.anyTimeMachineDrive()
}

func registerTimeMachine(name string) (out0 *zeroconf.Server) {
	defer logger.Out1(logger.In1("fileservers/servers/smbserv", "registerTimeMachine", "name", name), &out0)
	//The port is not used: Macs connect through the _smb._tcp service
	s, err := registerMDNS(name, "_adisk._tcp", 9, timeMachineRecords())
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		logger.PrintAndLog(logTitle, "Could not announce Time Machine over mDNS", err)
		return nil
	}
	return s
}

// refreshTimeMachineAnnouncement adds or withdraws the Time Machine record
// after a user picked a drive or dropped theirs.
func (m *Manager) refreshTimeMachineAnnouncement() {
	defer logger.Out0(logger.In1("fileservers/servers/smbserv", "Manager.refreshTimeMachineAnnouncement", "m", m))
	m.mu.Lock()
	defer m.mu.Unlock()
	a := m.announcer
	if a == nil || a.mdnsName == "" {
		return
	}
	want := m.wantTimeMachineAnnouncement()
	if want == (a.adisk != nil) {
		return
	}
	if a.adisk != nil {
		a.adisk.Shutdown()
		a.adisk = nil
	}
	if want {
		a.adisk = registerTimeMachine(a.mdnsName)
	}
}

// registerMDNS announces a service as zeroconf.Register does, under a host
// name Macs can resolve. zeroconf adds ".local" to the system host name
// unless it already ends in "local." with the dot, and macOS reports
// "name.local", so every record pointed at "name.local.local.". A name that
// already ends in .local is announced through RegisterProxy without it.
func registerMDNS(instance, service string, port int, txt []string) (out0 *zeroconf.Server, out1 error) {
	defer logger.Out2(logger.In4("fileservers/servers/smbserv", "registerMDNS", "instance", instance, "service", service, "port", port, "txt", txt), &out0, &out1)
	if hostname, err := os.Hostname(); err == nil {
		if host, trimmed := mdnsHostName(hostname); trimmed {
			if ips := interfaceIPs(); len(ips) > 0 {
				return zeroconf.RegisterProxy(instance, service, "local.", port, host, ips, txt, nil)
			}
		}
	}
	return zeroconf.Register(instance, service, "local.", port, txt, nil)
}

// mdnsHostName removes a ".local" the system host name already carries, and
// reports whether there was one.
func mdnsHostName(hostname string) (out0 string, out1 bool) {
	defer logger.Out2(logger.In1("fileservers/servers/smbserv", "mdnsHostName", "hostname", hostname), &out0, &out1)
	const suffix = ".local"
	h := strings.TrimSuffix(hostname, ".")
	if len(h) > len(suffix) && strings.EqualFold(h[len(h)-len(suffix):], suffix) {
		return h[:len(h)-len(suffix)], true
	}
	return h, false
}

// interfaceIPs lists the addresses zeroconf.Register announces itself: those
// of interfaces that are up and multicast, without loopback, and an
// interface's link local IPv6 only when it has no global one.
func interfaceIPs() (out0 []string) {
	defer logger.Out1(logger.In0("fileservers/servers/smbserv", "interfaceIPs"), &out0)
	out := []string{}
	ifaces, err := net.Interfaces()
	if err != nil {
		logger.DebugErr("fileservers/servers/smbserv", err)
		return out
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagMulticast == 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		var v6, v6local []string
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok || ipnet.IP.IsLoopback() {
				continue
			}
			switch {
			case ipnet.IP.To4() != nil:
				out = append(out, ipnet.IP.String())
			case ipnet.IP.IsGlobalUnicast():
				v6 = append(v6, ipnet.IP.String())
			case ipnet.IP.IsLinkLocalUnicast():
				v6local = append(v6local, ipnet.IP.String())
			}
		}
		if len(v6) == 0 {
			v6 = v6local
		}
		out = append(out, v6...)
	}
	return out
}
