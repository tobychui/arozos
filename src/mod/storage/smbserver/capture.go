package smbserver

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"imuslab.com/arozos/mod/storage/smbserver/auth"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	capture.go

	An opt in debug recording, for the defects Windows reports as a vague
	error long after the cause. It writes a pcap of what the server read and
	wrote, with Ethernet, IP and TCP framing made up from the connection, so
	Wireshark decodes it. It needs no root and works on every host, unlike
	tcpdump.

	A capture holds file names and is only for an admin to read. Two things
	never reach it. Windows sends an NTLM login for the signed in user
	unprompted, derived from their real password, so every AUTHENTICATE has its
	response blanked. And file contents are cut from large messages unless
	CaptureFull is set.
*/

const (
	captureCut      = 512 //Bytes kept of a large message
	captureLargeMsg = 4096
	captureSegment  = 60000
)

type capture struct {
	mu      sync.Mutex
	pcap    *bufio.Writer
	pcapF   *os.File
	trace   *bufio.Writer
	traceF  *os.File
	full    bool
	streams map[uint64]*captureStream
}

type captureStream struct {
	ip   [2][4]byte
	port [2]uint16
	seq  [2]uint32
}

func newCapture(dir string, full bool) (*capture, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	stamp := time.Now().Format("20060102-150405")
	pcapF, err := os.OpenFile(filepath.Join(dir, "smb-"+stamp+".pcap"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return nil, err
	}
	traceF, err := os.OpenFile(filepath.Join(dir, "smb-"+stamp+".log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		pcapF.Close()
		return nil, err
	}

	c := &capture{
		pcap:    bufio.NewWriter(pcapF),
		pcapF:   pcapF,
		trace:   bufio.NewWriter(traceF),
		traceF:  traceF,
		full:    full,
		streams: map[uint64]*captureStream{},
	}
	h := make([]byte, 24)
	binary.LittleEndian.PutUint32(h[0:], 0xa1b2c3d4)
	binary.LittleEndian.PutUint16(h[4:], 2)
	binary.LittleEndian.PutUint16(h[6:], 4)
	binary.LittleEndian.PutUint32(h[16:], 262144)
	binary.LittleEndian.PutUint32(h[20:], 1) //LINKTYPE_ETHERNET
	c.pcap.Write(h)
	return c, nil
}

func (c *capture) tracef(conn uint64, format string, args ...any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fmt.Fprintf(c.trace, "%s conn=%d %s\n", time.Now().Format("15:04:05.000000"), conn, fmt.Sprintf(format, args...))
	c.trace.Flush()
}

func ip4Of(a net.Addr) ([4]byte, uint16) {
	var out [4]byte
	if tcp, ok := a.(*net.TCPAddr); ok {
		if v := tcp.IP.To4(); v != nil {
			copy(out[:], v)
		}
		return out, uint16(tcp.Port)
	}
	return out, 0
}

const (
	tcpFIN = 0x01
	tcpSYN = 0x02
	tcpPSH = 0x08
	tcpACK = 0x10
)

func (c *capture) packet(s *captureStream, dir int, flags byte, data []byte) {
	other := 1 - dir
	f := make([]byte, 54+len(data))
	f[5], f[11] = byte(dir+1), byte(other+1)
	f[12], f[13] = 0x08, 0x00
	ip := f[14:]
	ip[0] = 0x45
	binary.BigEndian.PutUint16(ip[2:], uint16(40+len(data)))
	ip[8], ip[9] = 64, 6
	copy(ip[12:], s.ip[dir][:])
	copy(ip[16:], s.ip[other][:])
	t := ip[20:]
	binary.BigEndian.PutUint16(t[0:], s.port[dir])
	binary.BigEndian.PutUint16(t[2:], s.port[other])
	binary.BigEndian.PutUint32(t[4:], s.seq[dir])
	if flags&tcpACK != 0 {
		binary.BigEndian.PutUint32(t[8:], s.seq[other])
	}
	t[12], t[13] = 0x50, flags
	binary.BigEndian.PutUint16(t[14:], 65535)
	copy(t[20:], data)

	now := time.Now()
	h := make([]byte, 16)
	binary.LittleEndian.PutUint32(h[0:], uint32(now.Unix()))
	binary.LittleEndian.PutUint32(h[4:], uint32(now.Nanosecond()/1000))
	binary.LittleEndian.PutUint32(h[8:], uint32(len(f)))
	binary.LittleEndian.PutUint32(h[12:], uint32(len(f)))
	c.pcap.Write(h)
	c.pcap.Write(f)

	s.seq[dir] += uint32(len(data))
	if flags&(tcpSYN|tcpFIN) != 0 {
		s.seq[dir]++
	}
}

// record writes one frame. Inbound means client to server.
func (c *capture) record(conn *conn, inbound bool, frame []byte) {
	//A copy is taken before redaction, the live frame must stay intact
	kept := frame
	if len(frame) > captureLargeMsg && !c.full {
		kept = frame[:captureCut]
	}
	data := make([]byte, 4+len(kept))
	data[1], data[2], data[3] = byte(len(kept)>>16), byte(len(kept)>>8), byte(len(kept))
	copy(data[4:], kept)
	if inbound && len(frame) >= wire.HeaderSize && wire.IsSMB2(frame) {
		auth.RedactAuthenticate(data)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.streams[conn.id]
	if s == nil {
		s = &captureStream{}
		s.ip[0], s.port[0] = ip4Of(conn.nc.RemoteAddr())
		s.ip[1], _ = ip4Of(conn.nc.LocalAddr())
		s.port[1] = 445 //Whatever the real port, it is how Wireshark knows this is SMB
		c.streams[conn.id] = s
		c.packet(s, 0, tcpSYN, nil)
		c.packet(s, 1, tcpSYN|tcpACK, nil)
		c.packet(s, 0, tcpACK, nil)
	}
	dir := 1
	if inbound {
		dir = 0
	}
	for len(data) > 0 {
		n := len(data)
		if n > captureSegment {
			n = captureSegment
		}
		c.packet(s, dir, tcpPSH|tcpACK, data[:n])
		data = data[n:]
	}
	c.pcap.Flush()
}

func (c *capture) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pcap.Flush()
	c.trace.Flush()
	c.pcapF.Close()
	c.traceF.Close()
}
