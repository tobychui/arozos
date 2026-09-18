package acn

/*
	ArozOS Cluster Node protocol (ACN) - outbound transport

	Transport.Do sends one signed request to a peer, picking the route:

		1. the peer is tunnelled to THIS node          -> over the tunnel
		2. the peer advertises a URL                   -> direct HTTPS
		3. the peer is tunnelled to another node       -> HTTPS to that node's
		                                                   relay endpoint, which
		                                                   forwards over its tunnel

	Callers never deal with routing; higher layers just name the node.
*/

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultRequestTimeout bounds one node-to-node request. Cloudflare returns
// 524 after 100 seconds, so anything long-running must be split into chunks.
const DefaultRequestTimeout = 60 * time.Second

// Transport sends signed requests to cluster peers.
type Transport struct {
	Signer   *Signer
	Resolver PeerResolver
	Hub      *TunnelHub //Tunnels terminating at this node, may be nil
	Client   *http.Client
}

func tlsConfig(insecure bool) *tls.Config {
	if !insecure {
		return nil
	}
	return &tls.Config{InsecureSkipVerify: true} //Admin opted in for self-signed LAN certificates
}

// NewTransport creates a transport. insecureTLS accepts self-signed peer
// certificates, which the admin can enable for LAN-only clusters.
func NewTransport(signer *Signer, resolver PeerResolver, hub *TunnelHub, insecureTLS bool) *Transport {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = tlsConfig(insecureTLS)
	tr.MaxIdleConnsPerHost = 8
	return &Transport{
		Signer:   signer,
		Resolver: resolver,
		Hub:      hub,
		Client: &http.Client{
			Transport: tr,
			Timeout:   DefaultRequestTimeout,
		},
	}
}

// SetInsecureTLS toggles acceptance of self-signed peer certificates.
func (t *Transport) SetInsecureTLS(insecure bool) {
	if tr, ok := t.Client.Transport.(*http.Transport); ok {
		tr.TLSClientConfig = tlsConfig(insecure)
		tr.CloseIdleConnections()
	}
}

// JoinURL glues a node base URL and an ACN path.
func JoinURL(baseURL string, path string) string {
	return strings.TrimRight(baseURL, "/") + path
}

// signedHeaders returns only the headers a relayed or tunnelled request must carry.
func signedHeaders(req *http.Request) http.Header {
	h := http.Header{}
	for _, k := range []string{HeaderNode, HeaderCluster, HeaderTimestamp, HeaderNonce, HeaderSignature, "Content-Type"} {
		if v := req.Header.Get(k); v != "" {
			h.Set(k, v)
		}
	}
	return h
}

func readResponse(resp *http.Response) (*Response, error) {
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxSignedBody))
	if err != nil {
		return nil, err
	}
	return &Response{Status: resp.StatusCode, Header: resp.Header, Body: body}, nil
}

// DoURL sends a request straight to a base URL. When sign is true the ACN
// headers are added; otherwise the request is anonymous (used before a node
// has joined, e.g. for hello and join).
func (t *Transport) DoURL(ctx context.Context, baseURL string, method string, path string, body []byte, sign bool) (*Response, error) {
	if body == nil {
		body = []byte{}
	}
	req, err := http.NewRequestWithContext(ctx, method, JoinURL(baseURL, path), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if sign {
		if t.Signer == nil {
			return nil, errors.New("transport has no signer")
		}
		t.Signer.Sign(req, path, body)
	}
	resp, err := t.Client.Do(req)
	if err != nil {
		return nil, err
	}
	return readResponse(resp)
}

// Do sends a signed request to the named cluster node. path is the ACN path
// including any query string.
func (t *Transport) Do(ctx context.Context, nodeID string, method string, path string, body []byte) (*Response, error) {
	if body == nil {
		body = []byte{}
	}
	if t.Signer == nil {
		return nil, errors.New("transport has no signer")
	}

	//Route 1: tunnelled to this node
	if t.Hub != nil && t.Hub.Connected(nodeID) {
		req, _ := http.NewRequest(method, path, nil)
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		t.Signer.Sign(req, path, body)
		return t.Hub.Do(ctx, nodeID, method, path, signedHeaders(req), body)
	}

	peer, ok := t.Resolver.ResolvePeer(nodeID)
	if !ok || peer == nil {
		return nil, ErrUnknownNode
	}

	//Route 2: direct
	if peer.AdvertiseURL != "" {
		return t.DoURL(ctx, peer.AdvertiseURL, method, path, body, true)
	}

	//Route 3: relay through the node terminating the peer's tunnel
	if peer.TunnelVia != "" && peer.TunnelVia != t.Signer.NodeID {
		via, ok := t.Resolver.ResolvePeer(peer.TunnelVia)
		if !ok || via == nil || via.AdvertiseURL == "" {
			return nil, ErrPeerNoEndpoint
		}
		req, err := http.NewRequestWithContext(ctx, method, JoinURL(via.AdvertiseURL, RelayPrefix+"/"+nodeID+path), bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		t.Signer.Sign(req, path, body) //signed over the ORIGINAL path
		resp, err := t.Client.Do(req)
		if err != nil {
			return nil, err
		}
		return readResponse(resp)
	}

	if peer.TunnelVia == t.Signer.NodeID {
		return nil, ErrTunnelNotConnected
	}
	return nil, ErrPeerNoEndpoint
}

// DoJSON posts in as JSON to a node and decodes the JSON reply into out
// (which may be nil). Non-2xx replies become errors.
func (t *Transport) DoJSON(ctx context.Context, nodeID string, method string, path string, in interface{}, out interface{}) error {
	var body []byte
	if in != nil {
		js, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = js
	}
	resp, err := t.Do(ctx, nodeID, method, path, body)
	if err != nil {
		return err
	}
	if err := resp.Error(); err != nil {
		return err
	}
	if out != nil && len(resp.Body) > 0 {
		return json.Unmarshal(resp.Body, out)
	}
	return nil
}
