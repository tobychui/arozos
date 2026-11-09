package ftp

import (
	"errors"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	ftp "github.com/fclairamb/ftpserverlib"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
)

// Options configure an FTP server.
type Options struct {
	ServerName    string
	Port          int    //Passive transfers use the two ports after it
	PassiveModeIP string //Public IP address handed out for passive transfers, empty for the local one
	IdleTimeout   int    //Seconds without a command before a client is dropped, 0 for 15 minutes
	AllowPublic   bool   //Accept clients from public addresses, not only private networks
	ReadOnly      bool   //Refuse every change to files
	//Authenticate decides a sign in: per user FTP access, login IP rules and
	//the password. It also logs it. remote is the client's IP address.
	Authenticate func(username, password, remote string) error
	//LookupUser returns the account of a signed in user
	LookupUser func(username string) (*user.User, error)
}

// Handler is the handler for the FTP server defined in arozos
type Handler struct {
	ServerName    string
	Port          int
	ServerRunning bool
	UPNPEnabled   bool
	server        *ftp.FtpServer
	driver        *mainDriver
}

// ClientInfo is one connected client, as the settings page lists it.
type ClientInfo struct {
	Username  string //Empty until the client signs in
	Address   string
	Connected int64 //Unix time
}

type client struct {
	cc        ftp.ClientContext
	connected int64
	mu        sync.Mutex
	user      *user.User
}

func (c *client) account() *user.User {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.user
}

type mainDriver struct {
	setting ftp.Settings
	opt     Options
	clients sync.Map //Client ID to *client
}

// NewFTPHandler creates a new handler for FTP Server as a wrapper to the ftpserverlib
func NewFTPHandler(opt Options) (*Handler, error) {
	if opt.Authenticate == nil || opt.LookupUser == nil {
		return nil, errors.New("no user functions given")
	}
	if opt.Port < 1 || opt.Port > 65533 {
		return nil, errors.New("the port must be a number from 1 to 65533")
	}
	driver := &mainDriver{
		setting: ftp.Settings{
			ListenAddr:  ":" + strconv.Itoa(opt.Port),
			PublicHost:  strings.TrimSpace(opt.PassiveModeIP),
			IdleTimeout: opt.IdleTimeout,
			PassiveTransferPortRange: &ftp.PortRange{
				Start: opt.Port + 1,
				End:   opt.Port + 2,
			},
		},
		opt: opt,
	}
	return &Handler{
		ServerName: opt.ServerName,
		Port:       opt.Port,
		server:     ftp.NewFtpServer(driver),
		driver:     driver,
	}, nil
}

// AddressAllowed tells whether a client at addr may connect. Clients on
// private, loopback and link local addresses always may.
func AddressAllowed(addr net.Addr, allowPublic bool) bool {
	if allowPublic {
		return true
	}
	ip := hostIP(addr)
	return ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast())
}

func hostIP(addr net.Addr) net.IP {
	if addr == nil {
		return nil
	}
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		host = addr.String()
	}
	return net.ParseIP(host)
}

func hostOf(addr net.Addr) string {
	if ip := hostIP(addr); ip != nil {
		return ip.String()
	}
	if addr == nil {
		return ""
	}
	return addr.String()
}

// Start listens on the port, so that a port in use is reported here, and
// serves clients in the background.
func (f *Handler) Start() error {
	if f.server == nil {
		return errors.New("FTP server not initiated")
	}
	if err := f.server.Listen(); err != nil {
		return err
	}
	go func(f *Handler) {
		logger.PrintAndLog("Ftp", "FTP Server Started, listening at: "+strconv.Itoa(f.Port), nil)
		f.server.Serve()
	}(f)
	f.ServerRunning = true
	return nil
}

// Close the FTP Server and disconnect every client
func (f *Handler) Close() {
	if f.server != nil {
		f.server.Stop()
		f.ServerRunning = false
	}
	if f.driver != nil {
		f.driver.clients.Range(func(_, value interface{}) bool {
			value.(*client).cc.Close()
			return true
		})
	}
}

// Clients lists who is connected, oldest connection first.
func (f *Handler) Clients() []ClientInfo {
	clients := []ClientInfo{}
	if f.driver == nil {
		return clients
	}
	f.driver.clients.Range(func(_, value interface{}) bool {
		c := value.(*client)
		info := ClientInfo{Address: hostOf(c.cc.RemoteAddr()), Connected: c.connected}
		if account := c.account(); account != nil {
			info.Username = account.Username
		}
		clients = append(clients, info)
		return true
	})
	sort.Slice(clients, func(a, b int) bool { return clients[a].Connected < clients[b].Connected })
	return clients
}

// DropUser disconnects every client signed in as username.
func (f *Handler) DropUser(username string) {
	if f.driver == nil {
		return
	}
	f.driver.clients.Range(func(_, value interface{}) bool {
		c := value.(*client)
		if account := c.account(); account != nil && account.Username == username {
			c.cc.Close()
		}
		return true
	})
}

func (m *mainDriver) newClient(cc ftp.ClientContext) {
	m.clients.Store(cc.ID(), &client{cc: cc, connected: time.Now().Unix()})
}
