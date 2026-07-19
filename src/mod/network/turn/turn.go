/*
Package turn provides the built-in Arozcast TURN relay.

Arozcast's screen-share feature establishes a direct WebRTC peer-to-peer
connection between the sender (screenshare.html) and the receiver
(index.html). On a LAN this works using host candidates, but across the
Internet the peers are usually behind NAT (home routers, carrier-grade NAT
on mobile) and a direct connection cannot be established with STUN alone —
a TURN relay is required to forward the media.

Because both peers already reach the same ArozOS host for signalling, the
cleanest place to run that relay is ArozOS itself. This package wraps a
pion/turn server (pure Go, MIT licensed, no system dependencies) and issues
short-lived, HMAC-signed credentials in the coturn "TURN REST API" style so
the relay is not an open proxy: only logged-in users that fetch
/api/arozcast/iceservers receive a credential, and each credential expires.
*/
package turn

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // SHA1-HMAC is the credential format coturn/RFC clients expect
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/pion/logging"
	pionturn "github.com/pion/turn/v4"
	"imuslab.com/arozos/mod/info/logger"
)

// defaultCredentialTTL is the lifetime of an issued TURN credential when the
// caller does not specify one. Screen-share sessions are usually short, but a
// generous window avoids mid-session credential expiry.
const defaultCredentialTTL = 12 * time.Hour

// defaultRealm is the TURN realm advertised when none is configured.
const defaultRealm = "arozos"

// Config configures the built-in TURN relay.
type Config struct {
	// ListenPort is the UDP and TCP port the relay listens on (e.g. 3478).
	ListenPort int

	// Realm is the TURN realm. Defaults to "arozos" when empty.
	Realm string

	// PublicIP is the public IP or hostname advertised to peers as the relay
	// address. When empty, the outbound interface address is auto-detected,
	// which is correct for LAN use and for hosts with a routable IP. Hosts
	// behind NAT should set this to their public IP (and forward ListenPort).
	PublicIP string

	// CredentialTTL is the lifetime of issued credentials. Zero uses the
	// package default.
	CredentialTTL time.Duration

	// TLSPort, when greater than zero, additionally starts a TURN-over-TLS
	// (TURNS) listener on that TCP port using the certificate at TLSCertFile /
	// TLSKeyFile. TURNS lets screen share traverse restrictive firewalls that
	// only permit outbound TLS (commonly port 443): the relayed media rides
	// inside a TLS connection that is indistinguishable from ordinary HTTPS.
	// When no certificate is configured, or it cannot be loaded, the TURNS
	// listener is skipped and the plain relay still runs.
	TLSPort     int
	TLSCertFile string
	TLSKeyFile  string
}

// Server wraps a pion TURN server together with the shared secret used to mint
// and validate short-lived credentials.
type Server struct {
	server        *pionturn.Server
	secret        []byte
	realm         string
	relayIP       net.IP
	advertiseHost string // original PublicIP string (may be a hostname); empty = derive from request
	listenPort    int
	ttl           time.Duration
	tlsEnabled    bool // true when the TURN-over-TLS (TURNS) listener is running
	tlsPort       int  // port of the TURNS listener; valid only when tlsEnabled
}

// NewServer starts a TURN relay listening on config.ListenPort (UDP and TCP).
// The returned Server must be Close()d on shutdown. It is safe for the caller
// to treat a non-nil error as "relay unavailable" and fall back to STUN-only.
func NewServer(config Config) (*Server, error) {
	if config.ListenPort <= 0 || config.ListenPort > 65535 {
		return nil, fmt.Errorf("invalid TURN listen port: %d", config.ListenPort)
	}

	realm := config.Realm
	if realm == "" {
		realm = defaultRealm
	}

	ttl := config.CredentialTTL
	if ttl <= 0 {
		ttl = defaultCredentialTTL
	}

	relayIP, err := resolveRelayIP(config.PublicIP)
	if err != nil {
		return nil, err
	}

	// Random per-process secret for signing ephemeral credentials.
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}

	s := &Server{
		secret:        secret,
		realm:         realm,
		relayIP:       relayIP,
		advertiseHost: strings.TrimSpace(config.PublicIP),
		listenPort:    config.ListenPort,
		ttl:           ttl,
	}

	relayGenerator := &pionturn.RelayAddressGeneratorStatic{
		RelayAddress: relayIP,
		Address:      "0.0.0.0",
	}

	listenAddr := "0.0.0.0:" + strconv.Itoa(config.ListenPort)

	// pion only takes ownership of the conns/listeners when NewServer succeeds,
	// so track everything we open and release it if a later step fails.
	var opened []io.Closer
	closeOpened := func() {
		for _, c := range opened {
			_ = c.Close()
		}
	}

	udpConn, err := net.ListenPacket("udp4", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("turn udp listen on %s: %w", listenAddr, err)
	}
	opened = append(opened, udpConn)

	tcpListener, err := net.Listen("tcp4", listenAddr)
	if err != nil {
		closeOpened()
		return nil, fmt.Errorf("turn tcp listen on %s: %w", listenAddr, err)
	}
	opened = append(opened, tcpListener)

	listenerConfigs := []pionturn.ListenerConfig{{
		Listener:              tcpListener,
		RelayAddressGenerator: relayGenerator,
	}}

	// Optional TURN-over-TLS (TURNS) listener. A failure here is non-fatal: log
	// it and keep serving the plain relay rather than denying screen share to
	// everyone over a misconfigured certificate or busy port.
	if config.TLSPort > 0 {
		tlsListener, err := newTLSListener(config)
		if err != nil {
			logger.PrintAndLog("Arozcast TURN", "TURN-over-TLS (TURNS) listener disabled", err)
		} else {
			opened = append(opened, tlsListener)
			listenerConfigs = append(listenerConfigs, pionturn.ListenerConfig{
				Listener:              tlsListener,
				RelayAddressGenerator: relayGenerator,
			})
			s.tlsEnabled = true
			s.tlsPort = config.TLSPort
		}
	}

	server, err := pionturn.NewServer(pionturn.ServerConfig{
		Realm:         realm,
		AuthHandler:   s.authHandler,
		LoggerFactory: pionLoggerFactory{},
		PacketConnConfigs: []pionturn.PacketConnConfig{{
			PacketConn:            udpConn,
			RelayAddressGenerator: relayGenerator,
		}},
		ListenerConfigs: listenerConfigs,
	})
	if err != nil {
		closeOpened()
		return nil, err
	}

	s.server = server
	return s, nil
}

// newTLSListener builds the TLS listener backing the TURN-over-TLS (TURNS)
// endpoint from the certificate configured in config. The caller takes
// ownership of the returned listener.
func newTLSListener(config Config) (net.Listener, error) {
	if config.TLSCertFile == "" || config.TLSKeyFile == "" {
		return nil, errors.New("no TLS certificate configured")
	}
	cert, err := tls.LoadX509KeyPair(config.TLSCertFile, config.TLSKeyFile)
	if err != nil {
		return nil, fmt.Errorf("cannot load TLS certificate: %w", err)
	}
	tlsAddr := "0.0.0.0:" + strconv.Itoa(config.TLSPort)
	listener, err := tls.Listen("tcp4", tlsAddr, &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	})
	if err != nil {
		return nil, fmt.Errorf("turns tcp listen on %s: %w", tlsAddr, err)
	}
	return listener, nil
}

// authHandler validates an incoming TURN credential. It is the pion AuthHandler
// callback bound to this server's secret and realm.
func (s *Server) authHandler(username, realm string, _ net.Addr) ([]byte, bool) {
	return validateCredential(s.secret, realm, username, time.Now())
}

// Credentials mints a fresh ephemeral username/password pair for the given
// identity (typically the logged-in username). The credential is valid for the
// server's configured TTL.
func (s *Server) Credentials(identity string) (username, password string) {
	return buildCredential(s.secret, identity, time.Now().Add(s.ttl))
}

// AdvertiseHost returns the configured public host/IP that clients should dial
// for the relay, or an empty string when it should be derived from the request
// (i.e. the host the client used to reach ArozOS).
func (s *Server) AdvertiseHost() string { return s.advertiseHost }

// ListenPort returns the port the relay listens on.
func (s *Server) ListenPort() int { return s.listenPort }

// TLSEnabled reports whether the TURN-over-TLS (TURNS) listener is running.
func (s *Server) TLSEnabled() bool { return s != nil && s.tlsEnabled }

// TLSPort returns the port of the TURN-over-TLS (TURNS) listener, or 0 when
// TLS is not enabled.
func (s *Server) TLSPort() int { return s.tlsPort }

// Realm returns the TURN realm.
func (s *Server) Realm() string { return s.realm }

// Close stops the relay and releases its listeners.
func (s *Server) Close() error {
	if s == nil || s.server == nil {
		return nil
	}
	return s.server.Close()
}

// ── credential helpers (pure, unit-tested) ─────────────────────────────────

// buildCredential returns a coturn-style TURN REST API credential pair:
//
//	username = "<unix-expiry>[:identity]"
//	password = base64(HMAC-SHA1(secret, username))
func buildCredential(secret []byte, identity string, expiry time.Time) (username, password string) {
	username = strconv.FormatInt(expiry.Unix(), 10)
	if identity != "" {
		username += ":" + identity
	}
	return username, signCredential(secret, username)
}

// signCredential computes the base64 HMAC-SHA1 of username keyed by secret.
func signCredential(secret []byte, username string) string {
	mac := hmac.New(sha1.New, secret)
	mac.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// validateCredential parses a username's embedded expiry and derives the auth
// key pion expects (key = GenerateAuthKey(username, realm, HMAC(secret))).
// ok is false only when the username is malformed or expired. A forged or
// wrong-secret credential yields a key the client's password cannot match, so
// pion's STUN MESSAGE-INTEGRITY check rejects it.
func validateCredential(secret []byte, realm, username string, now time.Time) (key []byte, ok bool) {
	expiryField := username
	if idx := strings.Index(username, ":"); idx >= 0 {
		expiryField = username[:idx]
	}

	expiry, err := strconv.ParseInt(expiryField, 10, 64)
	if err != nil {
		return nil, false
	}
	if now.Unix() > expiry {
		return nil, false
	}

	password := signCredential(secret, username)
	return pionturn.GenerateAuthKey(username, realm, password), true
}

// resolveRelayIP turns the configured public address into the IP advertised to
// peers. An empty value auto-detects the outbound interface address; a hostname
// is resolved (IPv4 preferred).
func resolveRelayIP(configured string) (net.IP, error) {
	configured = strings.TrimSpace(configured)
	if configured == "" {
		return outboundIP()
	}

	if ip := net.ParseIP(configured); ip != nil {
		return ip, nil
	}

	ips, err := net.LookupIP(configured)
	if err != nil {
		return nil, fmt.Errorf("cannot resolve TURN public address %q: %w", configured, err)
	}
	for _, ip := range ips {
		if v4 := ip.To4(); v4 != nil {
			return v4, nil
		}
	}
	if len(ips) > 0 {
		return ips[0], nil
	}
	return nil, fmt.Errorf("cannot resolve TURN public address %q", configured)
}

// outboundIP returns the address of the interface used to reach the Internet.
func outboundIP() (net.IP, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return nil, errors.New("could not determine outbound IP for TURN relay: " + err.Error())
	}
	defer conn.Close()

	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP, nil
	}
	return nil, errors.New("could not determine outbound IP for TURN relay")
}

// ── pion logging bridge ────────────────────────────────────────────────────
// Routes the relay's own warnings/errors into the managed system log and drops
// the verbose trace/debug/info chatter.

type pionLoggerFactory struct{}

func (pionLoggerFactory) NewLogger(string) logging.LeveledLogger { return pionLogger{} }

type pionLogger struct{}

func (pionLogger) Trace(string)          {}
func (pionLogger) Tracef(string, ...any) {}
func (pionLogger) Debug(string)          {}
func (pionLogger) Debugf(string, ...any) {}
func (pionLogger) Info(string)           {}
func (pionLogger) Infof(string, ...any)  {}
func (pionLogger) Warn(msg string)       { logger.PrintAndLog("Arozcast TURN", msg, nil) }
func (pionLogger) Warnf(format string, args ...any) {
	logger.PrintAndLog("Arozcast TURN", fmt.Sprintf(format, args...), nil)
}
func (pionLogger) Error(msg string) { logger.PrintAndLog("Arozcast TURN", msg, nil) }
func (pionLogger) Errorf(format string, args ...any) {
	logger.PrintAndLog("Arozcast TURN", fmt.Sprintf(format, args...), nil)
}
