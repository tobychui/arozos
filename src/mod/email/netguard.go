package email

/*
	netguard.go

	Every outbound connection the mail backend makes goes through dialGuarded.

	A mail account is just a host and port typed in by a user, so without a
	guard any ArozOS user could make the server open connections into the
	LAN or to services bound to localhost. Unless the caller is an admin (or
	the admin allowed it), the host is resolved here, every address is
	checked, and the connection is made to the vetted IP — never to the name
	again — so a DNS answer cannot change between the check and the dial.
*/

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	dialTimeout      = 20 * time.Second
	handshakeTimeout = 20 * time.Second
)

// cgnatBlock is the carrier-grade NAT range (RFC 6598), used by Tailscale and
// many ISPs, which net.IP.IsPrivate does not cover.
var cgnatBlock = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

// isRestrictedIP reports whether ip points into a local or special network.
func isRestrictedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() ||
		cgnatBlock.Contains(ip)
}

// resolver is swapped by tests.
var lookupIPAddr = func(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

// dialGuarded opens a TCP connection to host:port. With allowPrivate false
// every resolved address must be public.
func dialGuarded(ctx context.Context, host string, port int, allowPrivate bool) (net.Conn, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return nil, errors.New("server host is empty")
	}
	if port <= 0 || port > 65535 {
		return nil, fmt.Errorf("invalid port %d", port)
	}

	dialer := &net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}
	if allowPrivate {
		return dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	}

	var addresses []net.IP
	if literal := net.ParseIP(strings.Trim(host, "[]")); literal != nil {
		addresses = []net.IP{literal}
	} else {
		resolved, err := lookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, address := range resolved {
			addresses = append(addresses, address.IP)
		}
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("%s did not resolve to any address", host)
	}

	var lastErr error = ErrBlockedAddress
	for _, ip := range addresses {
		if isRestrictedIP(ip) {
			continue
		}
		conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), strconv.Itoa(port)))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

// tlsConfigFor builds the client TLS configuration for a server name.
func tlsConfigFor(host string, nextProto string) *tls.Config {
	config := &tls.Config{
		ServerName: strings.Trim(host, "[]"),
		MinVersion: tls.VersionTLS12,
	}
	if nextProto != "" {
		config.NextProtos = []string{nextProto}
	}
	return config
}

// dialTLS opens an implicit-TLS connection with the handshake completed.
func dialTLS(ctx context.Context, host string, port int, allowPrivate bool, nextProto string) (net.Conn, error) {
	raw, err := dialGuarded(ctx, host, port, allowPrivate)
	if err != nil {
		return nil, err
	}
	tlsConn := tls.Client(raw, tlsConfigFor(host, nextProto))
	handshakeCtx, cancel := context.WithTimeout(ctx, handshakeTimeout)
	defer cancel()
	if err := tlsConn.HandshakeContext(handshakeCtx); err != nil {
		raw.Close()
		return nil, describeTLSError(err)
	}
	return tlsConn, nil
}

// describeTLSError turns the common certificate failures into sentences.
func describeTLSError(err error) error {
	var hostnameErr *tls.CertificateVerificationError
	if errors.As(err, &hostnameErr) {
		return fmt.Errorf("the server certificate could not be verified: %v", hostnameErr.Err)
	}
	if strings.Contains(err.Error(), "first record does not look like a TLS handshake") {
		return errors.New("the server did not answer with TLS, try STARTTLS or a different port")
	}
	return err
}

// guardedHTTPClient returns an HTTP client whose connections obey the same
// address policy, used for autoconfig documents fetched from a user-typed
// domain.
func guardedHTTPClient(allowPrivate bool, timeout time.Duration) *http.Client {
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, portText, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			port, err := strconv.Atoi(portText)
			if err != nil {
				return nil, err
			}
			return dialGuarded(ctx, host, port, allowPrivate)
		},
		TLSHandshakeTimeout:   handshakeTimeout,
		ResponseHeaderTimeout: timeout,
		MaxIdleConns:          4,
		IdleConnTimeout:       30 * time.Second,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
}
