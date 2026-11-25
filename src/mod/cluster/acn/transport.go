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

	"imuslab.com/arozos/mod/info/logger"
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

func tlsConfig(insecure bool) (out0 *tls.Config) {
	defer logger.Out1(logger.In1("cluster/acn", "tlsConfig", "insecure", insecure), &out0)
	if !insecure {
		return nil
	}
	return &tls.Config{InsecureSkipVerify: true} //Admin opted in for self-signed LAN certificates
}

// NewTransport creates a transport. insecureTLS accepts self-signed peer
// certificates, which the admin can enable for LAN-only clusters.
func NewTransport(signer *Signer, resolver PeerResolver, hub *TunnelHub, insecureTLS bool) (out0 *Transport) {
	defer logger.Out1(logger.In4("cluster/acn", "NewTransport", "signer", signer, "&resolver", &resolver, "hub", hub, "insecureTLS", insecureTLS), &out0)
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
	defer logger.Out0(logger.In2("cluster/acn", "Transport.SetInsecureTLS", "t", t, "insecure", insecure))
	if tr, ok := t.Client.Transport.(*http.Transport); ok {
		tr.TLSClientConfig = tlsConfig(insecure)
		tr.CloseIdleConnections()
	}
}

// JoinURL glues a node base URL and an ACN path.
func JoinURL(baseURL string, path string) string {
	logger.DebugTrace("cluster/acn", "JoinURL")
	return strings.TrimRight(baseURL, "/") + path
}

// signedHeaders returns the headers a relayed or tunnelled request must
// carry: the signature headers, the content type and every X-Aroz-* header
// (higher layers use those for per-chunk metadata).
func signedHeaders(req *http.Request) (out0 http.Header) {
	defer logger.Out1(logger.In1("cluster/acn", "signedHeaders", "req", req), &out0)
	h := http.Header{}
	for k, vals := range req.Header {
		ck := http.CanonicalHeaderKey(k)
		if ck == "Content-Type" || strings.HasPrefix(ck, "X-Aroz-") {
			for _, v := range vals {
				h.Add(ck, v)
			}
		}
	}
	return h
}

func readResponse(resp *http.Response) (out0 *Response, out1 error) {
	defer logger.Out2(logger.In1("cluster/acn", "readResponse", "resp", resp), &out0, &out1)
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, MaxSignedBody))
	if err != nil {
		logger.DebugErr("cluster/acn", err)
		return nil, err
	}
	return &Response{Status: resp.StatusCode, Header: resp.Header, Body: body}, nil
}

// DoURL sends a request straight to a base URL. When sign is true the ACN
// headers are added; otherwise the request is anonymous (used before a node
// has joined, e.g. for hello and join).
func (t *Transport) DoURL(ctx context.Context, baseURL string, method string, path string, body []byte, sign bool) (out0 *Response, out1 error) {
	defer logger.Out2(logger.In7("cluster/acn", "Transport.DoURL", "t", t, "ctx", ctx, "baseURL", baseURL, "method", method, "path", path, "body", body, "sign", sign), &out0, &out1)
	if body == nil {
		body = []byte{}
	}
	req, err := http.NewRequestWithContext(ctx, method, JoinURL(baseURL, path), bytes.NewReader(body))
	if err != nil {
		logger.DebugErr("cluster/acn", err)
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
		logger.DebugErr("cluster/acn", err)
		return nil, err
	}
	return readResponse(resp)
}

// Do sends a signed request to the named cluster node. path is the ACN path
// including any query string.
func (t *Transport) Do(ctx context.Context, nodeID string, method string, path string, body []byte) (*Response, error) {
	logger.DebugTrace("cluster/acn", "Transport.Do")
	return t.DoWithHeaders(ctx, nodeID, method, path, body, nil)
}

func applyExtra(req *http.Request, extra http.Header) {
	defer logger.Out0(logger.In2("cluster/acn", "applyExtra", "req", req, "&extra", &extra))
	for k, vals := range extra {
		for _, v := range vals {
			req.Header.Add(k, v)
		}
	}
}

// DoWithHeaders is Do with additional request headers (only X-Aroz-* and
// Content-Type survive tunnel and relay hops).
func (t *Transport) DoWithHeaders(ctx context.Context, nodeID string, method string, path string, body []byte, extra http.Header) (out0 *Response, out1 error) {
	defer logger.Out2(logger.In7("cluster/acn", "Transport.DoWithHeaders", "t", t, "ctx", ctx, "nodeID", nodeID, "method", method, "path", path, "body", body, "&extra", &extra), &out0, &out1)
	if body == nil {
		body = []byte{}
	}
	if t.Signer == nil {
		return nil, errors.New("transport has no signer")
	}
	contentType := "application/json"
	if extra != nil && extra.Get("Content-Type") != "" {
		contentType = extra.Get("Content-Type")
	}

	//Route 1: tunnelled to this node
	if t.Hub != nil && t.Hub.Connected(nodeID) {
		req, _ := http.NewRequest(method, path, nil)
		if len(body) > 0 {
			req.Header.Set("Content-Type", contentType)
		}
		applyExtra(req, extra)
		t.Signer.Sign(req, path, body)
		return t.Hub.Do(ctx, nodeID, method, path, signedHeaders(req), body)
	}

	peer, ok := t.Resolver.ResolvePeer(nodeID)
	if !ok || peer == nil {
		return nil, ErrUnknownNode
	}

	//Route 2: direct
	if peer.AdvertiseURL != "" {
		req, err := http.NewRequestWithContext(ctx, method, JoinURL(peer.AdvertiseURL, path), bytes.NewReader(body))
		if err != nil {
			logger.DebugErr("cluster/acn", err)
			return nil, err
		}
		if len(body) > 0 {
			req.Header.Set("Content-Type", contentType)
		}
		applyExtra(req, extra)
		t.Signer.Sign(req, path, body)
		resp, err := t.Client.Do(req)
		if err != nil {
			logger.DebugErr("cluster/acn", err)
			return nil, err
		}
		return readResponse(resp)
	}

	//Route 3: relay through the node terminating the peer's tunnel
	if peer.TunnelVia != "" && peer.TunnelVia != t.Signer.NodeID {
		via, ok := t.Resolver.ResolvePeer(peer.TunnelVia)
		if !ok || via == nil || via.AdvertiseURL == "" {
			return nil, ErrPeerNoEndpoint
		}
		req, err := http.NewRequestWithContext(ctx, method, JoinURL(via.AdvertiseURL, RelayPrefix+"/"+nodeID+path), bytes.NewReader(body))
		if err != nil {
			logger.DebugErr("cluster/acn", err)
			return nil, err
		}
		if len(body) > 0 {
			req.Header.Set("Content-Type", contentType)
		}
		applyExtra(req, extra)
		t.Signer.Sign(req, path, body) //signed over the ORIGINAL path
		resp, err := t.Client.Do(req)
		if err != nil {
			logger.DebugErr("cluster/acn", err)
			return nil, err
		}
		return readResponse(resp)
	}

	if peer.TunnelVia == t.Signer.NodeID {
		return nil, ErrTunnelNotConnected
	}
	return nil, ErrPeerNoEndpoint
}

// DoJSON2 sends in as JSON and returns the raw response, leaving status
// interpretation to the caller (for endpoints that use 409 as a signal).
func (t *Transport) DoJSON2(ctx context.Context, nodeID string, method string, path string, in interface{}) (out0 *Response, out1 error) {
	defer logger.Out2(logger.In6("cluster/acn", "Transport.DoJSON2", "t", t, "ctx", ctx, "nodeID", nodeID, "method", method, "path", path, "in", in), &out0, &out1)
	var body []byte
	if in != nil {
		js, err := json.Marshal(in)
		if err != nil {
			logger.DebugErr("cluster/acn", err)
			return nil, err
		}
		body = js
	}
	return t.Do(ctx, nodeID, method, path, body)
}

// DoJSON posts in as JSON to a node and decodes the JSON reply into out
// (which may be nil). Non-2xx replies become errors.
func (t *Transport) DoJSON(ctx context.Context, nodeID string, method string, path string, in interface{}, out interface{}) (out0 error) {
	defer logger.Out1(logger.In7("cluster/acn", "Transport.DoJSON", "t", t, "ctx", ctx, "nodeID", nodeID, "method", method, "path", path, "in", in, "out", out), &out0)
	var body []byte
	if in != nil {
		js, err := json.Marshal(in)
		if err != nil {
			logger.DebugErr("cluster/acn", err)
			return err
		}
		body = js
	}
	resp, err := t.Do(ctx, nodeID, method, path, body)
	if err != nil {
		logger.DebugErr("cluster/acn", err)
		return err
	}
	if err := resp.Error(); err != nil {
		logger.DebugErr("cluster/acn", err)
		return err
	}
	if out != nil && len(resp.Body) > 0 {
		return json.Unmarshal(resp.Body, out)
	}
	return nil
}
