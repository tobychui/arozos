// Package smbserver is an SMB 2.1 to 3.1.1 file server written for ArozOS, so
// that Windows Explorer can open ArozOS drives with no Samba install.
//
// Layout: wire reads and writes messages, crypt signs them, auth checks logins,
// rpc answers IPC$, state keeps share modes and locks, and this package ties
// them to a Backend. Only the aroz package imports ArozOS code.
package smbserver

import (
	"crypto/rand"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/storage/smbserver/state"
	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

const logTitle = "SMB"

// ErrFileTooLarge is what a backend returns for a file it will not stage. The
// client is told STATUS_FILE_TOO_LARGE.
var ErrFileTooLarge = errors.New("smbserver: the file is too large for this drive")

// Limits. The read and write sizes match what Samba offers Windows.
const (
	maxTransact     = 8 << 20
	maxPreloginSize = 128 << 10
	maxFrameSize    = maxTransact + 64<<10
	maxCredits      = 2048
	maxExtraCredits = 32 //Most a single response adds on top of what was spent
	maxInFlight     = 32 //Requests running at once. 32 MiB of 1 MiB reads covers any link, and fits a small board
	maxCompound     = 32
	maxOpens        = 1 << 16
	maxSessions     = 8

	defaultLoginTimeout = 30 * time.Second
	defaultLoginDelay   = 2 * time.Second
	defaultPendingAfter = time.Second
	defaultNotifyPoll   = 3 * time.Second
	defaultMaxConns     = 256
	defaultMaxPerIP     = 32
)

// Config describes one server.
type Config struct {
	Address    string //Listen address, for example ":445"
	ServerName string //NetBIOS style name shown to clients
	Workgroup  string
	DNSName    string
	DNSDomain  string
	GUID       [16]byte //Stable identity of this install
	Backend    Backend

	CaptureDir  string //When set, write a pcap and a trace log here
	CaptureFull bool   //Keep file contents in the pcap

	LoginTimeout time.Duration
	LoginDelay   time.Duration //Added to a failed login
	PendingAfter time.Duration //A request still running after this gets STATUS_PENDING
	NotifyPoll   time.Duration //How often watched local folders are listed; negative is never

	//NoLeases turns client caching off. LeaseBreakTimeout is how long a
	//client has to answer a break, LeasePoll how often leased files on local
	//drives are checked for changes made around the server
	NoLeases          bool
	LeaseBreakTimeout time.Duration
	LeasePoll         time.Duration

	//RequireEncryption refuses clients that cannot encrypt (SMB 2.1, and
	//3.x clients with encryption off) and every unencrypted request
	RequireEncryption bool
	MaxConns          int
	MaxPerIP          int
}

// Server is a running SMB server.
type Server struct {
	cfg        Config
	listener   net.Listener
	files      *state.Table
	names      *nameCache
	machineSID wire.SID
	startTime  time.Time
	capture    *capture
	resume     resumeKeys
	watches    watchers
	leases     leases
	durables   durableTable

	mu      sync.Mutex
	conns   map[*conn]struct{}
	perIP   map[string]int
	closed  bool
	nextID  atomic.Uint64
	fileSeq atomic.Uint64
	wg      sync.WaitGroup
}

// New validates a config and prepares a server. Call Start to listen.
func New(cfg Config) (*Server, error) {
	if cfg.Backend == nil {
		return nil, errors.New("smbserver: a backend is required")
	}
	if cfg.ServerName == "" {
		cfg.ServerName = "AROZOS"
	}
	if len(cfg.ServerName) > 15 {
		cfg.ServerName = cfg.ServerName[:15]
	}
	if cfg.Workgroup == "" {
		cfg.Workgroup = "WORKGROUP"
	}
	if cfg.DNSName == "" {
		cfg.DNSName = cfg.ServerName
	}
	if cfg.DNSDomain == "" {
		cfg.DNSDomain = "local"
	}
	if cfg.GUID == ([16]byte{}) {
		if _, err := rand.Read(cfg.GUID[:]); err != nil {
			return nil, err
		}
	}
	if cfg.LoginTimeout == 0 {
		cfg.LoginTimeout = defaultLoginTimeout
	}
	if cfg.LoginDelay == 0 {
		cfg.LoginDelay = defaultLoginDelay
	}
	if cfg.NotifyPoll == 0 {
		cfg.NotifyPoll = defaultNotifyPoll
	}
	if cfg.LeaseBreakTimeout == 0 {
		cfg.LeaseBreakTimeout = defaultLeaseBreakTimeout
	}
	if cfg.LeasePoll == 0 {
		cfg.LeasePoll = defaultLeasePoll
	}
	if cfg.PendingAfter == 0 {
		cfg.PendingAfter = defaultPendingAfter
	}
	if cfg.MaxConns == 0 {
		cfg.MaxConns = defaultMaxConns
	}
	if cfg.MaxPerIP == 0 {
		cfg.MaxPerIP = defaultMaxPerIP
	}

	s := &Server{
		cfg:        cfg,
		files:      state.NewTable(),
		names:      newNameCache(),
		machineSID: wire.MachineSID(cfg.GUID[:]),
		startTime:  time.Now(),
		conns:      map[*conn]struct{}{},
		perIP:      map[string]int{},
	}
	s.fileSeq.Store(1000)
	s.leases.init(s)

	if cfg.CaptureDir != "" {
		c, err := newCapture(cfg.CaptureDir, cfg.CaptureFull)
		if err != nil {
			return nil, err
		}
		s.capture = c
	}
	return s, nil
}

// checkIPv4Free refuses an address another program holds on IPv4. On macOS a
// dual stack listener binds beside an IPv4 one without any error, and then IPv4
// clients reach the other program while this server reports that it is running.
func checkIPv4Free(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil || port == "0" || (host != "" && host != "0.0.0.0") {
		return nil
	}
	probe, err := net.Listen("tcp4", address)
	if err != nil {
		return err
	}
	return probe.Close()
}

// Start binds the listener and begins accepting connections.
func (s *Server) Start() error {
	if err := checkIPv4Free(s.cfg.Address); err != nil {
		return err
	}
	l, err := net.Listen("tcp", s.cfg.Address)
	if err != nil {
		return err
	}
	s.listener = l
	logger.PrintAndLog(logTitle, "Listening on "+l.Addr().String(), nil)

	s.wg.Add(1)
	go s.acceptLoop()
	return nil
}

// Addr returns the bound address. Useful when listening on port 0.
func (s *Server) Addr() net.Addr {
	if s.listener == nil {
		return nil
	}
	return s.listener.Addr()
}

func (s *Server) acceptLoop() {
	defer s.wg.Done()
	for {
		nc, err := s.listener.Accept()
		if err != nil {
			s.mu.Lock()
			closed := s.closed
			s.mu.Unlock()
			if !closed {
				logger.PrintAndLog(logTitle, "Accept failed", err)
			}
			return
		}
		s.admit(nc)
	}
}

func remoteIP(nc net.Conn) (net.IP, string) {
	if tcp, ok := nc.RemoteAddr().(*net.TCPAddr); ok {
		return tcp.IP, tcp.IP.String()
	}
	host, _, _ := net.SplitHostPort(nc.RemoteAddr().String())
	return net.ParseIP(host), host
}

// admit applies the limits that apply before a client has said anything.
func (s *Server) admit(nc net.Conn) {
	ip, key := remoteIP(nc)
	if !s.cfg.Backend.Allow(ip) {
		logger.PrintAndLog(logTitle, "Refused connection from "+nc.RemoteAddr().String(), nil)
		nc.Close()
		return
	}

	s.mu.Lock()
	if s.closed || len(s.conns) >= s.cfg.MaxConns || s.perIP[key] >= s.cfg.MaxPerIP {
		s.mu.Unlock()
		logger.PrintAndLog(logTitle, "Too many connections, refused "+nc.RemoteAddr().String(), nil)
		nc.Close()
		return
	}
	c := newConn(s, nc, key)
	s.conns[c] = struct{}{}
	s.perIP[key]++
	s.mu.Unlock()

	if tcp, ok := nc.(*net.TCPConn); ok {
		tcp.SetNoDelay(true)
		tcp.SetKeepAlive(true)
		tcp.SetKeepAlivePeriod(30 * time.Second)
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		c.serve()
		s.mu.Lock()
		delete(s.conns, c)
		s.perIP[key]--
		if s.perIP[key] <= 0 {
			delete(s.perIP, key)
		}
		s.mu.Unlock()
	}()
}

// Client describes one logged in session, for an admin to look at.
type Client struct {
	Username  string
	Address   string
	Dialect   string
	Connected int64 //Unix seconds
	OpenFiles int
}

var dialectNames = map[uint16]string{
	wire.Dialect210: "2.1",
	wire.Dialect300: "3.0",
	wire.Dialect302: "3.0.2",
	wire.Dialect311: "3.1.1",
}

// Clients lists who is connected.
func (s *Server) Clients() []Client {
	s.mu.Lock()
	conns := make([]*conn, 0, len(s.conns))
	for c := range s.conns {
		conns = append(conns, c)
	}
	s.mu.Unlock()

	out := []Client{}
	for _, c := range conns {
		c.mu.Lock()
		dialect := dialectNames[c.dialect]
		sessions := make([]*session, 0, len(c.sessions))
		for _, sess := range c.sessions {
			sessions = append(sessions, sess)
		}
		c.mu.Unlock()
		for _, sess := range sessions {
			sess.mu.Lock()
			if sess.valid {
				out = append(out, Client{
					Username:  sess.username,
					Address:   c.remote,
					Dialect:   dialect,
					Connected: sess.since.Unix(),
					OpenFiles: len(sess.opens),
				})
			}
			sess.mu.Unlock()
		}
	}
	return out
}

// DropUser ends every connection a user is logged in on, and returns how many
// went. A session is checked at login, so a revoked password needs this to
// take effect on a client that is already in.
func (s *Server) DropUser(username string) int {
	s.mu.Lock()
	conns := make([]*conn, 0, len(s.conns))
	for c := range s.conns {
		conns = append(conns, c)
	}
	s.mu.Unlock()

	dropped := 0
	for _, c := range conns {
		if c.hasUser(username) {
			//A user whose access was taken away does not come back for
			//durable handles either
			c.revoked.Store(true)
			c.shutdown()
			dropped++
		}
	}
	return dropped
}

// ConnectionCount returns the number of open connections.
func (s *Server) ConnectionCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.conns)
}

// Close stops listening and drops every connection.
func (s *Server) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.watches.close()
	s.leases.close()
	list := make([]*conn, 0, len(s.conns))
	for c := range s.conns {
		list = append(list, c)
	}
	s.mu.Unlock()

	var err error
	if s.listener != nil {
		err = s.listener.Close()
	}
	for _, c := range list {
		c.nc.Close()
	}
	s.wg.Wait()
	if s.capture != nil {
		s.capture.close()
	}
	return err
}
