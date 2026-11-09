package sftpserver

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pkg/sftp"
	uuid "github.com/satori/go.uuid"
	"golang.org/x/crypto/ssh"
	"imuslab.com/arozos/mod/info/logger"
)

type SFTPConfig struct {
	ListeningIP string     //In the format of 0.0.0.0:2022
	HostKey     ssh.Signer //See LoadOrCreateHostKey
	AllowPublic bool       //Accept clients from public addresses, not only private networks
	ReadOnly    bool       //Refuse every change to files
	//Authenticate checks a sign in (password, login IP rules) and logs it.
	//remote is the client's IP address.
	Authenticate func(username, password, remote string) error
	//LookupUser returns what a signed in user may reach
	LookupUser func(username string) (Access, error)
}

// ClientInfo is one connected client, as the settings page lists it.
type ClientInfo struct {
	Username  string
	Address   string
	Connected int64  //Unix time
	Client    string //The software version the client announced
}

type connection struct {
	conn net.Conn
	info ClientInfo
}

type Instance struct {
	closed   atomic.Bool
	listener net.Listener
	conns    sync.Map //Connection ID to *connection
	once     sync.Once
}

// LoadOrCreateHostKey reads the server's host key, and creates one the first
// time. Every installation has its own key: a key shared by all of them would
// let anyone pose as any ArozOS server.
func LoadOrCreateHostKey(keyFile string) (ssh.Signer, error) {
	if data, err := os.ReadFile(keyFile); err == nil {
		return ssh.ParsePrivateKey(data)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	block, err := ssh.MarshalPrivateKey(private, "ArozOS SFTP host key")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(keyFile), 0700); err != nil {
		return nil, err
	}
	tmp := keyFile + ".tmp"
	if err := os.WriteFile(tmp, pem.EncodeToMemory(block), 0600); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, keyFile); err != nil {
		os.Remove(tmp)
		return nil, err
	}
	logger.PrintAndLog("Sftpserver", "Created a new SFTP host key", nil)
	return ssh.NewSignerFromKey(private)
}

// Fingerprint is how clients show a host key, e.g. SHA256:abc...
func Fingerprint(key ssh.Signer) string {
	return ssh.FingerprintSHA256(key.PublicKey())
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

// readOnlyAccess keeps everything a user may read and nothing they may change
type readOnlyAccess struct {
	Access
}

func (readOnlyAccess) CanWrite(string) bool { return false }

// Create a new SFTP Server
func NewSFTPServer(sftpConfig *SFTPConfig) (*Instance, error) {
	if sftpConfig.HostKey == nil {
		return nil, errors.New("no host key given")
	}
	if sftpConfig.Authenticate == nil || sftpConfig.LookupUser == nil {
		return nil, errors.New("no user functions given")
	}
	config := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if err := sftpConfig.Authenticate(c.User(), string(pass), hostOf(c.RemoteAddr())); err != nil {
				return nil, err
			}
			return nil, nil
		},
	}
	config.AddHostKey(sftpConfig.HostKey)

	listener, err := net.Listen("tcp", sftpConfig.ListeningIP)
	if err != nil {
		return nil, err
	}
	logger.PrintAndLog("Sftpserver", fmt.Sprintf("[SFTP] Listening on %v", listener.Addr()), nil)

	instance := &Instance{listener: listener}
	go func() {
		for {
			nConn, err := listener.Accept()
			if err != nil {
				return
			}
			go instance.serve(nConn, config, sftpConfig)
		}
	}()
	return instance, nil
}

// serve runs one client connection until it ends or the server closes
func (i *Instance) serve(nConn net.Conn, config *ssh.ServerConfig, sftpConfig *SFTPConfig) {
	defer nConn.Close()
	if !AddressAllowed(nConn.RemoteAddr(), sftpConfig.AllowPublic) {
		return
	}

	// Before use, a handshake must be performed on the incoming net.Conn.
	nConn.SetDeadline(time.Now().Add(2 * time.Minute))
	cx, chans, reqs, err := ssh.NewServerConn(nConn, config)
	if err != nil {
		return
	}
	nConn.SetDeadline(time.Time{})
	defer cx.Close()

	access, err := sftpConfig.LookupUser(cx.User())
	if err != nil {
		return
	}
	if sftpConfig.ReadOnly {
		access = readOnlyAccess{access}
	}

	id := uuid.NewV4().String()
	i.conns.Store(id, &connection{conn: nConn, info: ClientInfo{
		Username:  cx.User(),
		Address:   hostOf(nConn.RemoteAddr()),
		Connected: time.Now().Unix(),
		Client:    string(cx.ClientVersion()),
	}})
	defer i.conns.Delete(id)
	if i.closed.Load() {
		//Closed while this client was signing in
		return
	}
	logger.PrintAndLog("Sftpserver", fmt.Sprint("[SFTP] User Connected: ", cx.User()), nil)

	// The incoming Request channel must be serviced.
	go ssh.DiscardRequests(reqs)

	// Each session channel of this connection serves its own SFTP subsystem
	var sessions sync.WaitGroup
	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
			continue
		}
		channel, requests, err := newChannel.Accept()
		if err != nil {
			continue
		}

		// Sessions have out-of-band requests such as "shell", "pty-req" and
		// "env". Only the "sftp" subsystem is accepted.
		go func(in <-chan *ssh.Request) {
			for req := range in {
				ok := req.Type == "subsystem" && len(req.Payload) > 4 && string(req.Payload[4:]) == "sftp"
				req.Reply(ok, nil)
			}
		}(requests)

		sessions.Add(1)
		go func(channel ssh.Channel) {
			defer sessions.Done()
			server := sftp.NewRequestServer(channel, GetNewSFTPRoot(cx.User(), access))
			if err := server.Serve(); err != nil && !errors.Is(err, net.ErrClosed) && err.Error() != "EOF" {
				logger.PrintAndLog("Sftpserver", "sftp session of "+cx.User()+" ended with an error", err)
			}
			server.Close()
		}(channel)
	}
	sessions.Wait()
	logger.PrintAndLog("Sftpserver", "[SFTP] User Disconnected: "+cx.User(), nil)
}

// IsClosed tells whether Close was called.
func (i *Instance) IsClosed() bool {
	return i.closed.Load()
}

// Clients lists who is connected, oldest connection first.
func (i *Instance) Clients() []ClientInfo {
	clients := []ClientInfo{}
	i.conns.Range(func(_, value interface{}) bool {
		clients = append(clients, value.(*connection).info)
		return true
	})
	sort.Slice(clients, func(a, b int) bool { return clients[a].Connected < clients[b].Connected })
	return clients
}

// Close stops listening and disconnects every client.
func (i *Instance) Close() {
	i.once.Do(func() {
		i.closed.Store(true)
		if i.listener != nil {
			i.listener.Close()
		}
		i.conns.Range(func(_, value interface{}) bool {
			value.(*connection).conn.Close()
			return true
		})
		logger.PrintAndLog("Sftpserver", "[SFTP] SFTP Server Closed", nil)
	})
}
