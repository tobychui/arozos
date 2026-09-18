package acn

/*
	ArozOS Cluster Node protocol (ACN) - reverse tunnel

	Nodes that sit behind NAT or otherwise have no public URL keep one
	persistent WebSocket connection open to a reachable peer (the "host").
	HTTP requests destined for the tunnelled node are multiplexed over that
	socket as binary frames, executed against the tunnelled node's local ACN
	handler, and the responses are sent back over the same socket.

	Frame layout (binary WebSocket message):

		[1 byte kind][4 byte big-endian header length][header JSON][body bytes]

	Requests are signed by the ORIGINAL sender, so the tunnelled node verifies
	the same signature the host (or a relaying node) already verified.

	Cloudflare terminates idle WebSockets after roughly 100 seconds, so both
	ends ping every TunnelPingInterval.
*/

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	frameKindRequest  byte = 1
	frameKindResponse byte = 2

	TunnelPath         = BasePath + "/tunnel"
	TunnelPingInterval = 30 * time.Second
	TunnelReadTimeout  = 90 * time.Second
	// TunnelMaxFrame bounds a single multiplexed request or response so a 4MB
	// transfer chunk plus headers always fits with room to spare.
	TunnelMaxFrame = 16 << 20
)

var (
	ErrTunnelNotConnected = errors.New("target node is not connected through a tunnel on this node")
	ErrTunnelClosed       = errors.New("tunnel closed")
	ErrFrameTooLarge      = errors.New("tunnel frame exceeds maximum size")
)

type frameHeader struct {
	ID      string              `json:"id"`
	Method  string              `json:"m,omitempty"`
	Target  string              `json:"t,omitempty"` //path plus query
	Status  int                 `json:"s,omitempty"`
	Headers map[string][]string `json:"h,omitempty"`
}

func encodeFrame(kind byte, hdr frameHeader, body []byte) ([]byte, error) {
	hj, err := json.Marshal(hdr)
	if err != nil {
		return nil, err
	}
	if len(hj)+len(body)+5 > TunnelMaxFrame {
		return nil, ErrFrameTooLarge
	}
	buf := make([]byte, 5, 5+len(hj)+len(body))
	buf[0] = kind
	binary.BigEndian.PutUint32(buf[1:5], uint32(len(hj)))
	buf = append(buf, hj...)
	buf = append(buf, body...)
	return buf, nil
}

func decodeFrame(data []byte) (byte, frameHeader, []byte, error) {
	var hdr frameHeader
	if len(data) < 5 {
		return 0, hdr, nil, errors.New("tunnel frame too short")
	}
	kind := data[0]
	hlen := int(binary.BigEndian.Uint32(data[1:5]))
	if hlen < 0 || 5+hlen > len(data) {
		return 0, hdr, nil, errors.New("tunnel frame header length invalid")
	}
	if err := json.Unmarshal(data[5:5+hlen], &hdr); err != nil {
		return 0, hdr, nil, err
	}
	return kind, hdr, data[5+hlen:], nil
}

// Response is the buffered result of a node-to-node request.
type Response struct {
	Status int
	Header http.Header
	Body   []byte
}

// Error turns a non-2xx response into a descriptive error, nil otherwise.
func (r *Response) Error() error {
	if r == nil {
		return errors.New("empty response")
	}
	if r.Status >= 200 && r.Status < 300 {
		return nil
	}
	msg := strings.TrimSpace(string(r.Body))
	if len(msg) > 200 {
		msg = msg[:200]
	}
	return errors.New("remote node returned " + http.StatusText(r.Status) + ": " + msg)
}

// tunnelConn is one live WebSocket shared by both ends of a tunnel.
type tunnelConn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
	pending map[string]chan *Response
	pmu     sync.Mutex
	closed  chan struct{}
	once    sync.Once
	seq     uint64
}

func newTunnelConn(ws *websocket.Conn) *tunnelConn {
	ws.SetReadLimit(TunnelMaxFrame)
	return &tunnelConn{
		ws:      ws,
		pending: map[string]chan *Response{},
		closed:  make(chan struct{}),
	}
}

func (c *tunnelConn) write(kind byte, hdr frameHeader, body []byte) error {
	frame, err := encodeFrame(kind, hdr, body)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	select {
	case <-c.closed:
		return ErrTunnelClosed
	default:
	}
	c.ws.SetWriteDeadline(time.Now().Add(60 * time.Second))
	return c.ws.WriteMessage(websocket.BinaryMessage, frame)
}

func (c *tunnelConn) ping() error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(10*time.Second))
}

func (c *tunnelConn) close() {
	c.once.Do(func() {
		close(c.closed)
		c.ws.Close()
		c.pmu.Lock()
		for id, ch := range c.pending {
			close(ch)
			delete(c.pending, id)
		}
		c.pmu.Unlock()
	})
}

func (c *tunnelConn) isClosed() bool {
	select {
	case <-c.closed:
		return true
	default:
		return false
	}
}

// roundTrip sends a request frame and waits for its response frame.
func (c *tunnelConn) roundTrip(ctx context.Context, method string, target string, headers http.Header, body []byte) (*Response, error) {
	c.pmu.Lock()
	c.seq++
	id := newNonce()
	ch := make(chan *Response, 1)
	c.pending[id] = ch
	c.pmu.Unlock()

	cleanup := func() {
		c.pmu.Lock()
		delete(c.pending, id)
		c.pmu.Unlock()
	}

	err := c.write(frameKindRequest, frameHeader{
		ID:      id,
		Method:  method,
		Target:  target,
		Headers: map[string][]string(headers),
	}, body)
	if err != nil {
		cleanup()
		return nil, err
	}

	select {
	case resp, ok := <-ch:
		cleanup()
		if !ok || resp == nil {
			return nil, ErrTunnelClosed
		}
		return resp, nil
	case <-ctx.Done():
		cleanup()
		return nil, ctx.Err()
	case <-c.closed:
		cleanup()
		return nil, ErrTunnelClosed
	}
}

// serveRequest executes an incoming request frame against handler and writes
// the response frame back.
func (c *tunnelConn) serveRequest(handler http.Handler, hdr frameHeader, body []byte) {
	u, err := url.ParseRequestURI(hdr.Target)
	if err != nil || !strings.HasPrefix(hdr.Target, "/") {
		c.write(frameKindResponse, frameHeader{ID: hdr.ID, Status: http.StatusBadRequest}, []byte("invalid tunnel target"))
		return
	}
	req, err := http.NewRequest(hdr.Method, hdr.Target, bytes.NewReader(body))
	if err != nil {
		c.write(frameKindResponse, frameHeader{ID: hdr.ID, Status: http.StatusBadRequest}, []byte(err.Error()))
		return
	}
	req.URL = u
	req.RequestURI = hdr.Target
	req.RemoteAddr = "tunnel"
	for k, vals := range hdr.Headers {
		for _, v := range vals {
			req.Header.Add(k, v)
		}
	}
	req.ContentLength = int64(len(body))

	rec := &responseRecorder{header: http.Header{}, status: http.StatusOK}
	handler.ServeHTTP(rec, req)
	c.write(frameKindResponse, frameHeader{
		ID:      hdr.ID,
		Status:  rec.status,
		Headers: map[string][]string(rec.header),
	}, rec.body.Bytes())
}

// readLoop pumps frames until the socket dies. Response frames complete
// pending round trips; request frames are served through handler (nil when
// this end never expects requests).
func (c *tunnelConn) readLoop(handler http.Handler) {
	defer c.close()
	c.ws.SetReadDeadline(time.Now().Add(TunnelReadTimeout))
	c.ws.SetPongHandler(func(string) error {
		c.ws.SetReadDeadline(time.Now().Add(TunnelReadTimeout))
		return nil
	})
	c.ws.SetPingHandler(func(data string) error {
		c.ws.SetReadDeadline(time.Now().Add(TunnelReadTimeout))
		c.writeMu.Lock()
		defer c.writeMu.Unlock()
		return c.ws.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(10*time.Second))
	})

	for {
		mt, data, err := c.ws.ReadMessage()
		if err != nil {
			if !c.isClosed() && !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				logger.PrintAndLog("Cluster", "Tunnel read ended: "+err.Error(), nil)
			}
			return
		}
		c.ws.SetReadDeadline(time.Now().Add(TunnelReadTimeout))
		if mt != websocket.BinaryMessage {
			continue
		}
		kind, hdr, body, err := decodeFrame(data)
		if err != nil {
			continue
		}
		switch kind {
		case frameKindResponse:
			c.pmu.Lock()
			ch, ok := c.pending[hdr.ID]
			c.pmu.Unlock()
			if ok {
				ch <- &Response{Status: hdr.Status, Header: http.Header(hdr.Headers), Body: body}
			}
		case frameKindRequest:
			if handler != nil {
				go c.serveRequest(handler, hdr, body)
			}
		}
	}
}

// pingLoop keeps the socket alive through proxies until it closes.
func (c *tunnelConn) pingLoop() {
	ticker := time.NewTicker(TunnelPingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.closed:
			return
		case <-ticker.C:
			if err := c.ping(); err != nil {
				c.close()
				return
			}
		}
	}
}

// responseRecorder captures a handler's output for the response frame.
type responseRecorder struct {
	header http.Header
	status int
	body   bytes.Buffer
	wrote  bool
}

func (r *responseRecorder) Header() http.Header { return r.header }
func (r *responseRecorder) Write(b []byte) (int, error) {
	r.wrote = true
	return r.body.Write(b)
}
func (r *responseRecorder) WriteHeader(status int) {
	if !r.wrote {
		r.status = status
	}
}

/*
	Host side
*/

// TunnelHub terminates tunnels from NAT-only nodes on a reachable node.
type TunnelHub struct {
	Verifier     *Verifier
	OnConnect    func(nodeID string)
	OnDisconnect func(nodeID string)

	mu       sync.RWMutex
	conns    map[string]*tunnelConn
	upgrader websocket.Upgrader
}

// NewTunnelHub creates a hub whose incoming tunnels are authenticated by v.
func NewTunnelHub(v *Verifier) *TunnelHub {
	return &TunnelHub{
		Verifier: v,
		conns:    map[string]*tunnelConn{},
		upgrader: websocket.Upgrader{
			ReadBufferSize:  32 * 1024,
			WriteBufferSize: 32 * 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// HandleTunnel is the HTTP handler for TunnelPath. The upgrade request must be
// signed by a cluster member.
func (h *TunnelHub) HandleTunnel(w http.ResponseWriter, r *http.Request) {
	identity, _, err := h.Verifier.VerifyRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	ws, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn := newTunnelConn(ws)

	h.mu.Lock()
	if old, exists := h.conns[identity.NodeID]; exists {
		old.close()
	}
	h.conns[identity.NodeID] = conn
	h.mu.Unlock()
	logger.PrintAndLog("Cluster", "Tunnel established from node "+identity.NodeID, nil)
	if h.OnConnect != nil {
		h.OnConnect(identity.NodeID)
	}

	go conn.pingLoop()
	conn.readLoop(nil)

	h.mu.Lock()
	if cur, exists := h.conns[identity.NodeID]; exists && cur == conn {
		delete(h.conns, identity.NodeID)
	}
	h.mu.Unlock()
	logger.PrintAndLog("Cluster", "Tunnel from node "+identity.NodeID+" closed", nil)
	if h.OnDisconnect != nil {
		h.OnDisconnect(identity.NodeID)
	}
}

// Connected reports whether nodeID currently has a live tunnel here.
func (h *TunnelHub) Connected(nodeID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c, ok := h.conns[nodeID]
	return ok && !c.isClosed()
}

// ConnectedNodes lists the node IDs with a live tunnel.
func (h *TunnelHub) ConnectedNodes() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	ids := []string{}
	for id, c := range h.conns {
		if !c.isClosed() {
			ids = append(ids, id)
		}
	}
	return ids
}

// Do forwards an already signed request to the tunnelled node.
func (h *TunnelHub) Do(ctx context.Context, nodeID string, method string, target string, headers http.Header, body []byte) (*Response, error) {
	h.mu.RLock()
	c, ok := h.conns[nodeID]
	h.mu.RUnlock()
	if !ok || c.isClosed() {
		return nil, ErrTunnelNotConnected
	}
	return c.roundTrip(ctx, method, target, headers, body)
}

// Close drops every tunnel.
func (h *TunnelHub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, c := range h.conns {
		c.close()
		delete(h.conns, id)
	}
}

/*
	Client side
*/

// TunnelHost describes the reachable peer a NAT-only node should tunnel through.
type TunnelHost struct {
	NodeID string
	URL    string
}

// TunnelClient keeps a NAT-only node attached to a reachable peer.
type TunnelClient struct {
	Signer  *Signer
	Handler http.Handler //Local ACN handler that serves the multiplexed requests
	//PickHost returns the peer to connect to. ok is false when no host is available yet.
	PickHost      func() (TunnelHost, bool)
	InsecureTLS   bool
	OnStateChange func(connected bool, host TunnelHost)

	mu        sync.Mutex
	stop      chan struct{}
	running   bool
	connected bool
	host      TunnelHost
	current   *tunnelConn
	dialer    func(host TunnelHost) (*websocket.Conn, error)
}

// Start begins the connect / serve / reconnect loop in the background.
func (c *TunnelClient) Start() {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return
	}
	c.running = true
	c.stop = make(chan struct{})
	stop := c.stop
	c.mu.Unlock()
	go c.loop(stop)
}

// Stop closes the current tunnel and halts reconnection.
func (c *TunnelClient) Stop() {
	c.mu.Lock()
	if !c.running {
		c.mu.Unlock()
		return
	}
	c.running = false
	close(c.stop)
	cur := c.current
	c.mu.Unlock()
	if cur != nil {
		cur.close()
	}
}

// Reconnect drops the current tunnel so the loop picks a host again, used
// after the preferred host changes.
func (c *TunnelClient) Reconnect() {
	c.mu.Lock()
	cur := c.current
	c.mu.Unlock()
	if cur != nil {
		cur.close()
	}
}

// Status reports whether the tunnel is up and through which host.
func (c *TunnelClient) Status() (bool, TunnelHost) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected, c.host
}

func (c *TunnelClient) setState(connected bool, host TunnelHost, conn *tunnelConn) {
	c.mu.Lock()
	c.connected = connected
	c.host = host
	c.current = conn
	cb := c.OnStateChange
	c.mu.Unlock()
	if cb != nil {
		cb(connected, host)
	}
}

func (c *TunnelClient) dial(host TunnelHost) (*websocket.Conn, error) {
	if c.dialer != nil {
		return c.dialer(host)
	}
	wsURL, err := WebSocketURL(host.URL, TunnelPath)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, wsURL, nil)
	if err != nil {
		return nil, err
	}
	c.Signer.Sign(req, TunnelPath, []byte{})
	dialer := websocket.Dialer{
		HandshakeTimeout: 20 * time.Second,
		TLSClientConfig:  tlsConfig(c.InsecureTLS),
	}
	ws, resp, err := dialer.Dial(wsURL, req.Header)
	if err != nil {
		if resp != nil && resp.Body != nil {
			msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			resp.Body.Close()
			if len(msg) > 0 {
				return nil, errors.New(err.Error() + ": " + strings.TrimSpace(string(msg)))
			}
		}
		return nil, err
	}
	return ws, nil
}

func (c *TunnelClient) loop(stop chan struct{}) {
	backoff := 2 * time.Second
	for {
		select {
		case <-stop:
			return
		default:
		}

		host, ok := c.PickHost()
		if !ok {
			if !sleepOrStop(stop, 5*time.Second) {
				return
			}
			continue
		}

		ws, err := c.dial(host)
		if err != nil {
			logger.PrintAndLog("Cluster", "Tunnel to "+host.NodeID+" failed: "+err.Error(), nil)
			if !sleepOrStop(stop, backoff) {
				return
			}
			if backoff < 60*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = 2 * time.Second
		conn := newTunnelConn(ws)
		c.setState(true, host, conn)
		logger.PrintAndLog("Cluster", "Tunnel connected through node "+host.NodeID, nil)
		go conn.pingLoop()
		conn.readLoop(c.Handler) //blocks until the socket dies
		c.setState(false, host, nil)
		logger.PrintAndLog("Cluster", "Tunnel through node "+host.NodeID+" disconnected", nil)
		if !sleepOrStop(stop, backoff) {
			return
		}
	}
}

func sleepOrStop(stop chan struct{}, d time.Duration) bool {
	select {
	case <-stop:
		return false
	case <-time.After(d):
		return true
	}
}

// WebSocketURL converts a node base URL plus path into a ws:// or wss:// URL.
func WebSocketURL(baseURL string, path string) (string, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "ws", "wss":
	default:
		return "", errors.New("unsupported node URL scheme: " + u.Scheme)
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawQuery = ""
	return u.String(), nil
}
