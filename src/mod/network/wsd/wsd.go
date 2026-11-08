// Package wsd makes a host show up in the Network view of Windows Explorer:
// a WS-Discovery responder (UDP 3702 with a metadata service on TCP 5357),
// and an LLMNR responder (UDP 5355) for the one name it announces, so that
// Windows can also reach the computer it lists.
//
// NetBIOS browsing, which once filled that view, is gone from current
// Windows. This is the same job wsdd does for Samba.
package wsd

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/ipv4"
	"imuslab.com/arozos/mod/info/logger"
)

const logTitle = "WSD"

// Defaults of the protocol.
const (
	DiscoveryPort = 3702
	MetadataPort  = 5357
	LLMNRPort     = 5355
)

var (
	discoveryGroup = net.IPv4(239, 255, 255, 250)
	llmnrGroup     = net.IPv4(224, 0, 0, 252)
)

// Config describes the computer to announce.
type Config struct {
	Name      string //Computer name, as \\Name will be opened
	Workgroup string
	UUID      string //Stable across restarts, without "urn:uuid:"

	//Ports, for tests; zero is the standard one, negative turns that part off
	DiscoveryPort int
	MetadataPort  int
	LLMNRPort     int

	//NoMulticast answers unicast requests only, for tests
	NoMulticast bool
}

// Responder is a running announcement.
type Responder struct {
	cfg      Config
	instance int64

	udp   *ipv4.PacketConn
	llmnr *ipv4.PacketConn
	http  *http.Server

	mu       sync.Mutex
	seen     []string //Recent message ids, since requests come several times
	sequence int
	closed   bool
	wg       sync.WaitGroup
}

// NewUUID returns a random UUID, for callers without a stable one.
func NewUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func port(value, standard int) int {
	if value == 0 {
		return standard
	}
	return value
}

// Start begins answering and announces the computer. A part whose port is
// taken (another WS-Discovery service, or an LLMNR responder such as
// systemd-resolved) is left out with a log line rather than failing all.
func Start(cfg Config) (*Responder, error) {
	if cfg.Name == "" || cfg.UUID == "" {
		return nil, errors.New("wsd: a name and a uuid are required")
	}
	if cfg.Workgroup == "" {
		cfg.Workgroup = "WORKGROUP"
	}
	r := &Responder{cfg: cfg, instance: time.Now().Unix()}

	if p := port(cfg.DiscoveryPort, DiscoveryPort); p > 0 {
		pc, err := r.listen(p, discoveryGroup)
		if err != nil {
			return nil, fmt.Errorf("wsd: discovery port %d: %w", p, err)
		}
		r.udp = pc
	}
	if p := port(cfg.MetadataPort, MetadataPort); p > 0 {
		l, err := net.Listen("tcp", fmt.Sprintf(":%d", p))
		if err != nil {
			r.Close()
			return nil, fmt.Errorf("wsd: metadata port %d: %w", p, err)
		}
		//Deliberately public: it answers one SOAP Get with the computer's
		//name, which the multicast announcement already told everyone
		r.http = &http.Server{Handler: http.HandlerFunc(r.serveMetadata), ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second}
		r.wg.Add(1)
		go func() {
			defer r.wg.Done()
			r.http.Serve(l)
		}()
	}
	if p := port(cfg.LLMNRPort, LLMNRPort); p > 0 {
		pc, err := r.listen(p, llmnrGroup)
		if err != nil {
			logger.PrintAndLog(logTitle, fmt.Sprintf("LLMNR is off, port %d is in use: Windows may list %s without reaching it", p, cfg.Name), err)
		} else {
			r.llmnr = pc
		}
	}

	if r.udp != nil {
		r.wg.Add(1)
		go r.serveDiscovery()
		r.announce(actionHello)
	}
	if r.llmnr != nil {
		r.wg.Add(1)
		go r.serveLLMNR()
	}
	logger.PrintAndLog(logTitle, "Announcing "+cfg.Name+" to the Windows Network view", nil)
	return r, nil
}

// listen opens a UDP port and joins its group on every interface that can.
func (r *Responder) listen(p int, group net.IP) (*ipv4.PacketConn, error) {
	c, err := net.ListenPacket("udp4", fmt.Sprintf(":%d", p))
	if err != nil {
		return nil, err
	}
	pc := ipv4.NewPacketConn(c)
	//Not every platform reports the interface; replies then use the first
	pc.SetControlMessage(ipv4.FlagInterface|ipv4.FlagDst, true)
	if !r.cfg.NoMulticast {
		joined := 0
		for _, ifi := range multicastInterfaces() {
			if err := pc.JoinGroup(&ifi, &net.UDPAddr{IP: group}); err == nil {
				joined++
			}
		}
		if joined == 0 {
			logger.PrintAndLog(logTitle, fmt.Sprintf("No interface joined %s on port %d", group, p), nil)
		}
		pc.SetMulticastTTL(1)
	}
	return pc, nil
}

// multicastInterfaces are the LAN interfaces: up, multicast and not loopback.
func multicastInterfaces() []net.Interface {
	list, err := net.Interfaces()
	if err != nil {
		return nil
	}
	out := []net.Interface{}
	for _, ifi := range list {
		if ifi.Flags&net.FlagUp == 0 || ifi.Flags&net.FlagMulticast == 0 || ifi.Flags&net.FlagLoopback != 0 {
			continue
		}
		if interfaceIPv4(&ifi) != nil {
			out = append(out, ifi)
		}
	}
	return out
}

func interfaceIPv4(ifi *net.Interface) net.IP {
	addrs, err := ifi.Addrs()
	if err != nil {
		return nil
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok {
			if ip := ipnet.IP.To4(); ip != nil && !ip.IsLinkLocalUnicast() {
				return ip
			}
		}
	}
	return nil
}

// replyIP picks the address a requester can reach this host on: the one of
// the interface the request came in on, else one on the requester's subnet.
func replyIP(cm *ipv4.ControlMessage, from net.Addr) net.IP {
	if cm != nil && cm.IfIndex > 0 {
		if ifi, err := net.InterfaceByIndex(cm.IfIndex); err == nil {
			if ip := interfaceIPv4(ifi); ip != nil {
				return ip
			}
			if ifi.Flags&net.FlagLoopback != 0 {
				return net.IPv4(127, 0, 0, 1)
			}
		}
	}
	src, _ := from.(*net.UDPAddr)
	if src != nil && src.IP.IsLoopback() {
		return net.IPv4(127, 0, 0, 1)
	}
	for _, ifi := range multicastInterfaces() {
		addrs, _ := ifi.Addrs()
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok && src != nil && ipnet.Contains(src.IP) {
				return ipnet.IP.To4()
			}
		}
	}
	for _, ifi := range multicastInterfaces() {
		return interfaceIPv4(&ifi)
	}
	return nil
}

// firstTime reports a message id not seen lately. Windows sends each
// request more than once.
func (r *Responder) firstTime(id string) bool {
	if id == "" {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.seen {
		if s == id {
			return false
		}
	}
	r.seen = append(r.seen, id)
	if len(r.seen) > 128 {
		r.seen = r.seen[len(r.seen)-128:]
	}
	return true
}

func (r *Responder) appSequence() string {
	r.mu.Lock()
	r.sequence++
	n := r.sequence
	r.mu.Unlock()
	return fmt.Sprintf(`<wsd:AppSequence InstanceId="%d" SequenceId="urn:uuid:%s" MessageNumber="%d"/>`, r.instance, r.cfg.UUID, n)
}

func (r *Responder) serveDiscovery() {
	defer r.wg.Done()
	buf := make([]byte, 65536)
	for {
		n, cm, from, err := r.udp.ReadFrom(buf)
		if err != nil {
			if r.isClosed() {
				return
			}
			continue
		}
		m, err := parseMessage(buf[:n])
		if err != nil || !r.firstTime(m.messageID) {
			continue
		}
		var reply []byte
		switch m.action {
		case actionProbe:
			if !m.matchesProbe() {
				continue
			}
			body := "<wsd:ProbeMatches><wsd:ProbeMatch>" + endpoint(r.cfg.UUID) +
				"<wsd:Types>" + typesText + "</wsd:Types><wsd:MetadataVersion>1</wsd:MetadataVersion>" +
				"</wsd:ProbeMatch></wsd:ProbeMatches>"
			reply = envelope(toAnonymous, actionProbeMatches, "urn:uuid:"+NewUUID(), m.messageID, r.appSequence(), body)
		case actionResolve:
			if m.address != "urn:uuid:"+r.cfg.UUID {
				continue
			}
			ip := replyIP(cm, from)
			if ip == nil {
				continue
			}
			body := "<wsd:ResolveMatches><wsd:ResolveMatch>" + endpoint(r.cfg.UUID) +
				"<wsd:Types>" + typesText + "</wsd:Types>" +
				"<wsd:XAddrs>" + xaddrs(ip.String(), port(r.cfg.MetadataPort, MetadataPort), r.cfg.UUID) + "</wsd:XAddrs>" +
				"<wsd:MetadataVersion>1</wsd:MetadataVersion></wsd:ResolveMatch></wsd:ResolveMatches>"
			reply = envelope(toAnonymous, actionResolveMatches, "urn:uuid:"+NewUUID(), m.messageID, r.appSequence(), body)
		default:
			continue
		}
		var out *ipv4.ControlMessage
		if cm != nil && cm.IfIndex > 0 {
			out = &ipv4.ControlMessage{IfIndex: cm.IfIndex}
		}
		if _, err := r.udp.WriteTo(reply, out, from); err != nil && out != nil {
			r.udp.WriteTo(reply, nil, from)
		}
	}
}

// announce multicasts Hello or Bye on every interface, twice, as UDP may
// lose one.
func (r *Responder) announce(action string) {
	if r.cfg.NoMulticast || r.udp == nil {
		return
	}
	dst := &net.UDPAddr{IP: discoveryGroup, Port: port(r.cfg.DiscoveryPort, DiscoveryPort)}
	for _, ifi := range multicastInterfaces() {
		ip := interfaceIPv4(&ifi)
		var body string
		if action == actionHello {
			body = "<wsd:Hello>" + endpoint(r.cfg.UUID) + "<wsd:Types>" + typesText + "</wsd:Types>" +
				"<wsd:XAddrs>" + xaddrs(ip.String(), port(r.cfg.MetadataPort, MetadataPort), r.cfg.UUID) + "</wsd:XAddrs>" +
				"<wsd:MetadataVersion>1</wsd:MetadataVersion></wsd:Hello>"
		} else {
			body = "<wsd:Bye>" + endpoint(r.cfg.UUID) + "</wsd:Bye>"
		}
		msg := envelope(toDiscovery, action, "urn:uuid:"+NewUUID(), "", r.appSequence(), body)
		ifi := ifi
		if err := r.udp.SetMulticastInterface(&ifi); err != nil {
			continue
		}
		for i := 0; i < 2; i++ {
			r.udp.WriteTo(msg, nil, dst)
			time.Sleep(50 * time.Millisecond)
		}
	}
}

// serveMetadata answers the Get that Windows sends to the XAddrs.
func (r *Responder) serveMetadata(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost || strings.Trim(req.URL.Path, "/") != r.cfg.UUID {
		http.NotFound(w, req)
		return
	}
	data, err := io.ReadAll(io.LimitReader(req.Body, 64<<10))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	m, err := parseMessage(data)
	if err != nil || m.action != actionGet {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	reply := envelope(toAnonymous, actionGetResponse, "urn:uuid:"+NewUUID(), m.messageID, "", metadata(r.cfg.UUID, r.cfg.Name, r.cfg.Workgroup))
	w.Header().Set("Content-Type", "application/soap+xml")
	w.Write(reply)
}

func (r *Responder) isClosed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closed
}

// Close says goodbye and stops answering.
func (r *Responder) Close() error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil
	}
	r.closed = true
	r.mu.Unlock()

	r.announce(actionBye)
	if r.udp != nil {
		r.udp.Close()
	}
	if r.llmnr != nil {
		r.llmnr.Close()
	}
	if r.http != nil {
		r.http.Close()
	}
	r.wg.Wait()
	return nil
}
