package reverseproxy

import (
	"bytes"
	"io/ioutil"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

const fakeHopHeader = "X-Fake-Hop-Header-For-Test"

func init() {
	hopHeaders = append(hopHeaders, fakeHopHeader)
}

func TestReverseProxy(t *testing.T) {
	backendResponse := "I am the backend"
	backendStatus := 404
	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		if len(req.TransferEncoding) > 0 {
			t.Errorf("backend got unexpected TransferEncoding: %v", req.TransferEncoding)
		}

		if req.Header.Get("X-Forwarded-For") == "" {
			t.Errorf("didn't get X-Forwarded-For header")
		}

		if c := req.Header.Get("Connection"); c != "" {
			t.Errorf("handler got Connection header value %q", c)
		}

		if c := req.Header.Get("Upgrade"); c != "" {
			t.Errorf("handler got Upgrade header value %q", c)
		}

		if c := req.Header.Get("Proxy-Connection"); c != "" {
			t.Errorf("handler got Proxy-Connection header value %q", c)
		}

		if c := req.Host; c == "" {
			t.Errorf("backend got Host header %q", c)
		}

		rw.Header().Set("X-Foo", "bar")
		rw.Header().Set(fakeHopHeader, "foo")
		rw.Header().Set("Trailers", "not a special header field name")
		rw.Header().Set("Trailer", "X-Trailer")
		rw.Header().Set("Upgrade", "foo")
		rw.Header().Add("X-Multi-Value", "foo")
		rw.Header().Add("X-Multi-Value", "bar")
		http.SetCookie(rw, &http.Cookie{Name: "flavor", Value: "chocolateChip"})
		rw.WriteHeader(backendStatus)
		rw.Write([]byte(backendResponse))
		rw.Header().Set("X-Trailer", "trailer_value")
	}))

	defer backend.Close()
	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	proxyHandler := NewReverseProxy(backendURL)
	proxyHandler.ErrorLog = log.New(ioutil.Discard, "", 0)
	frontend := httptest.NewServer(proxyHandler)
	defer frontend.Close()

	getReq, _ := http.NewRequest("GET", frontend.URL, nil)
	getReq.Host = "some host"
	getReq.Header.Set("Connection", "close")
	getReq.Header.Set("Proxy-Connection", "should be deleted")
	getReq.Header.Set("Upgrade", "foo")
	getReq.Close = true
	res, err := http.DefaultClient.Do(getReq)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if g, e := res.StatusCode, backendStatus; g != e {
		t.Errorf("got res.StatusCode %d; expected %d", g, e)
	}

	if g, e := res.Header.Get("X-Foo"), "bar"; g != e {
		t.Errorf("got X-Foo %q; expected %q", g, e)
	}

	if c := res.Header.Get(fakeHopHeader); c != "" {
		t.Errorf("got %s header value %q", fakeHopHeader, c)
	}

	if g, e := res.Header.Get("Trailers"), "not a special header field name"; g != e {
		t.Errorf("header Trailers = %q; want %q", g, e)
	}

	if g, e := len(res.Header["X-Multi-Value"]), 2; g != e {
		t.Errorf("got %d X-Multi-Value header values; expected %d", g, e)
	}

	if g, e := len(res.Header["Set-Cookie"]), 1; g != e {
		t.Fatalf("got %d SetCookies, want %d", g, e)
	}

	if g, e := res.Trailer, (http.Header{"X-Trailer": nil}); !reflect.DeepEqual(g, e) {
		t.Errorf("before reading body, Trailer = %#v; want %#v", g, e)
	}

	if cookie := res.Cookies()[0]; cookie.Name != "flavor" {
		t.Errorf("unexpected cookie %q", cookie.Name)
	}

	bodyBytes, _ := ioutil.ReadAll(res.Body)

	if g, e := string(bodyBytes), backendResponse; g != e {
		t.Errorf("got body %q; expected %q", g, e)
	}

	if g, e := res.Trailer.Get("X-Trailer"), "trailer_value"; g != e {
		t.Errorf("Trailer(X-Trailer) = %q ; want %q", g, e)
	}

}

func TestReverseProxyStripHeadersPresentInConnection(t *testing.T) {
	const fakeConnectionToken = "X-Fake-Connection-Token"
	const backendResponse = "I am the backend"

	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		if c := req.Header.Get(fakeConnectionToken); c != "" {
			t.Errorf("handler got header %q = %q; want empty", fakeConnectionToken, c)
		}

		if c := req.Header.Get("Upgrade"); c != "" {
			t.Errorf("handler got header %q = %q; want empty", "Upgrade", c)
		}

		rw.Header().Set("Connection", "Upgrade, "+fakeConnectionToken)
		rw.Header().Set("Upgrade", "should be deleted")
		rw.Header().Set(fakeConnectionToken, "should be deleted")
		rw.Write([]byte(backendResponse))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	proxyHandler := NewReverseProxy(backendURL)
	frontend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		proxyHandler.ServeHTTP(rw, req)
		if c := req.Header.Get("Upgrade"); c != "original value" {
			t.Errorf("handler modified header %q = %q; want %q", "Upgrade", c, "original value")
		}
	}))
	defer frontend.Close()

	getReq, _ := http.NewRequest("GET", frontend.URL, nil)
	getReq.Header.Set("Connection", "Upgrade, "+fakeConnectionToken)
	getReq.Header.Set("Upgrade", "original value")
	getReq.Header.Set(fakeConnectionToken, "should be deleted")
	res, err := http.DefaultClient.Do(getReq)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer res.Body.Close()
	bodyBytes, err := ioutil.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}

	if g, e := string(bodyBytes), backendResponse; g != e {
		t.Errorf("got body %q; want %q", g, e)
	}

	if c := res.Header.Get("Upgrade"); c != "" {
		t.Errorf("handler got header %q = %q; want empty", "Upgrade", c)
	}

	if c := res.Header.Get(fakeConnectionToken); c != "" {
		t.Errorf("handler got header %q = %q; want empty", fakeConnectionToken, c)
	}
}

func TestXForwardedFor(t *testing.T) {
	const prevForwardedFor = "client ip"
	const backendResponse = "I am the backend"
	const backendStatus = 404
	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		if req.Header.Get("X-Forwarded-For") == "" {
			t.Errorf("didn't get X-Forwarded-For header")
		}

		if !strings.Contains(req.Header.Get("X-Forwarded-For"), prevForwardedFor) {
			t.Errorf("X-Forwarded-For didn't contain prior data")
		}

		rw.WriteHeader(backendStatus)
		rw.Write([]byte(backendResponse))
	}))

	defer backend.Close()
	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	proxyHandler := NewReverseProxy(backendURL)
	frontend := httptest.NewServer(proxyHandler)
	defer frontend.Close()

	getReq, _ := http.NewRequest("GET", frontend.URL, nil)
	getReq.Header.Set("X-Forwarded-For", prevForwardedFor)
	getReq.Close = true
	res, err := http.DefaultClient.Do(getReq)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer res.Body.Close()

	if g, e := res.StatusCode, backendStatus; g != e {
		t.Errorf("got res.StatusCode %d; expected %d", g, e)
	}
	bodyBytes, _ := ioutil.ReadAll(res.Body)
	if g, e := string(bodyBytes), backendResponse; g != e {
		t.Errorf("got body %q; expected %q", g, e)
	}
}

var proxyQueryTests = []struct {
	baseSuffix string // suffix to add to backend URL
	reqSuffix  string // suffix to add to frontend's request URL
	want       string // what backend should see for final request URL (without ?)
}{
	{"", "", ""},
	{"?sta=tic", "?us=er", "sta=tic&us=er"},
	{"", "?us=er", "us=er"},
	{"?sta=tic", "", "sta=tic"},
}

func TestReverseProxyQuery(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		rw.Header().Set("X-Got-Query", req.URL.RawQuery)
		rw.Write([]byte("hi"))
	}))
	defer backend.Close()

	for i, tt := range proxyQueryTests {
		backendURL, err := url.Parse(backend.URL + tt.baseSuffix)
		if err != nil {
			t.Fatal(err)
		}
		frontend := httptest.NewServer(NewReverseProxy(backendURL))
		req, _ := http.NewRequest("GET", frontend.URL+tt.reqSuffix, nil)
		req.Close = true
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%d. Get: %v", i, err)
		}
		if g, e := res.Header.Get("X-Got-Query"), tt.want; g != e {
			t.Errorf("%d. got query %q; expected %q", i, g, e)
		}
		res.Body.Close()
		frontend.Close()
	}
}

func TestReverseProxyFlushInterval(t *testing.T) {
	const expected = "hi"
	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		rw.Write([]byte(expected))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	proxyHandler := NewReverseProxy(backendURL)
	proxyHandler.FlushInterval = time.Microsecond

	done := make(chan bool)
	onExitFlushLoop = func() { done <- true }

	frontend := httptest.NewServer(proxyHandler)
	defer frontend.Close()

	getReq, _ := http.NewRequest("GET", frontend.URL, nil)
	getReq.Close = true
	res, err := http.DefaultClient.Do(getReq)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	defer res.Body.Close()

	bodyBytes, _ := ioutil.ReadAll(res.Body)
	if g, e := string(bodyBytes), expected; g != e {
		t.Errorf("got body %q; expected %q", g, e)
	}

	select {
	case <-done:
		// do nothing
	case <-time.After(3 * time.Second):
		t.Errorf("maxLatencyWriter flushLoop() never exited")
	}
}

func TestReverseProxyCancelation(t *testing.T) {
	const backendResponse = "I am the backend"

	reqInFlight := make(chan bool)
	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		close(reqInFlight)

		select {
		case <-time.After(time.Second * 3):
			t.Errorf("Handler never saw CloseNotify")
		case <-rw.(http.CloseNotifier).CloseNotify():
			// do nothing
		}

		rw.WriteHeader(http.StatusOK)
		rw.Write([]byte(backendResponse))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	proxyHandler := NewReverseProxy(backendURL)
	proxyHandler.ErrorLog = log.New(ioutil.Discard, "", 0)
	frontend := httptest.NewServer(proxyHandler)
	defer frontend.Close()

	getReq, err := http.NewRequest("GET", frontend.URL, nil)
	if err != nil {
		t.Fatal(err)
	}

	go func() {
		<-reqInFlight
		http.DefaultTransport.(*http.Transport).CancelRequest(getReq)
	}()

	res, err := http.DefaultClient.Do(getReq)

	if res != nil {
		t.Errorf("got response %v; want nil", res.Status)
	}

	if err == nil {
		t.Error("DefaultClient.Do() returned nil error; want non-nil error")
	}
}

func TestReverProxyPost(t *testing.T) {
	const backendResponse = "I am the backend"
	const backendStatus = 200
	var requestBody = bytes.Repeat([]byte("a"), 1<<20)

	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		requestData, err := ioutil.ReadAll(req.Body)
		if err != nil {
			t.Errorf("Backend body read = %v", err)
		}

		if len(requestData) != len(requestBody) {
			t.Errorf("Backend read %d request body bytes; want %d", len(requestData), len(requestBody))
		}

		if !bytes.Equal(requestData, requestBody) {
			t.Error("Backend read wrong request body.")
		}

		rw.Write([]byte(backendResponse))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	proxyHandler := NewReverseProxy(backendURL)
	frontend := httptest.NewServer(proxyHandler)
	defer frontend.Close()

	res, err := http.Post(frontend.URL, "", bytes.NewReader(requestBody))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	bodyBytes, err := ioutil.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}

	if g, e := string(bodyBytes), backendResponse; g != e {
		t.Errorf("got response %v, want %v", g, e)
	}
}

func TestHTTPTunnel(t *testing.T) {
	const backendResponse = "I am the backend"
	backend := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		rw.Write([]byte(backendResponse))
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}

	proxyHandler := NewReverseProxy(backendURL)
	frontend := httptest.NewServer(proxyHandler)
	defer frontend.Close()

	frontendURL, err := url.Parse(frontend.URL)
	if err != nil {
		t.Fatal(err)
	}

	getReq := &http.Request{
		Method: "CONNECT",
		URL: &url.URL{
			Host:   frontendURL.Host,
			Scheme: frontendURL.Scheme,
			Path:   "google.com:80",
		},
		Header: http.Header{},
	}

	res, err := http.DefaultTransport.(*http.Transport).RoundTrip(getReq)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Status != "200 OK" {
		t.Errorf("got response status %v, want %v", res.Status, "200 OK")
	}
}
