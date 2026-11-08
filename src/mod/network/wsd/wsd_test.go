package wsd

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// A Probe as Windows 11 sends it, prefixes and all.
const windowsProbe = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof">
<soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>
<wsa:MessageID>urn:uuid:%s</wsa:MessageID></soap:Header>
<soap:Body><wsd:Probe><wsd:Types>wsdp:Device</wsd:Types></wsd:Probe></soap:Body></soap:Envelope>`

const resolveTemplate = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<s:Header><a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Resolve</a:Action>
<a:MessageID>urn:uuid:%s</a:MessageID></s:Header>
<s:Body><d:Resolve><a:EndpointReference><a:Address>urn:uuid:%s</a:Address></a:EndpointReference></d:Resolve></s:Body></s:Envelope>`

func TestParseProbeResolvesPrefixes(t *testing.T) {
	cases := []struct {
		name  string
		types string
		xmlns string
		match bool
	}{
		{"device", "wsdp:Device", `xmlns:wsdp="` + nsDevProf + `"`, true},
		{"other prefix", "x:Device", `xmlns:x="` + nsDevProf + `"`, true},
		{"computer", "p:Computer", `xmlns:p="` + nsPub + `"`, true},
		{"printer", "p:PrintDeviceType", `xmlns:p="http://schemas.microsoft.com/windows/2006/08/wdp/print"`, false},
		{"no types", "", "", true},
		{"wrong namespace", "wsdp:Device", `xmlns:wsdp="urn:other"`, false},
	}
	for _, c := range cases {
		msg := `<s:Envelope xmlns:s="` + nsSOAP + `" xmlns:a="` + nsAddress + `" xmlns:d="` + nsDiscovery + `" ` + c.xmlns + `>` +
			`<s:Header><a:Action>` + actionProbe + `</a:Action><a:MessageID>urn:uuid:1</a:MessageID></s:Header>` +
			`<s:Body><d:Probe><d:Types>` + c.types + `</d:Types></d:Probe></s:Body></s:Envelope>`
		m, err := parseMessage([]byte(msg))
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if m.action != actionProbe || m.messageID != "urn:uuid:1" {
			t.Errorf("%s: %+v", c.name, m)
		}
		if m.matchesProbe() != c.match {
			t.Errorf("%s: match = %v", c.name, !c.match)
		}
	}
}

func TestProbeWithScopesDoesNotMatch(t *testing.T) {
	msg := `<s:Envelope xmlns:s="` + nsSOAP + `" xmlns:a="` + nsAddress + `" xmlns:d="` + nsDiscovery + `">` +
		`<s:Header><a:Action>` + actionProbe + `</a:Action></s:Header>` +
		`<s:Body><d:Probe><d:Scopes>ldap:///ou=engineering</d:Scopes></d:Probe></s:Body></s:Envelope>`
	m, err := parseMessage([]byte(msg))
	if err != nil {
		t.Fatal(err)
	}
	if m.matchesProbe() {
		t.Error("this host has no scopes")
	}
}

func TestParseRefusesJunk(t *testing.T) {
	for _, junk := range []string{"", "not xml", "<a><b></a>", strings.Repeat("<x>", 100)} {
		if _, err := parseMessage([]byte(junk)); err == nil {
			t.Errorf("%q parsed", junk)
		}
	}
}

func freeUDP(t *testing.T) int {
	t.Helper()
	c, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

func freeTCP(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

const testUUID = "9c3b6c1e-1d2f-4c3e-8a7b-5f6e7d8c9b0a"

func startTest(t *testing.T) (*Responder, Config) {
	t.Helper()
	cfg := Config{Name: "AROZTEST", Workgroup: "WORKGROUP", UUID: testUUID,
		DiscoveryPort: freeUDP(t), MetadataPort: freeTCP(t), LLMNRPort: freeUDP(t), NoMulticast: true}
	r, err := Start(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r, cfg
}

// ask sends a datagram to the responder and returns its answer.
func ask(t *testing.T, port int, msg []byte) ([]byte, error) {
	t.Helper()
	c, err := net.Dial("udp4", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write(msg)
	c.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, 65536)
	n, err := c.Read(buf)
	return buf[:n], err
}

func TestProbeResolveAndGet(t *testing.T) {
	_, cfg := startTest(t)

	reply, err := ask(t, cfg.DiscoveryPort, []byte(fmt.Sprintf(windowsProbe, NewUUID())))
	if err != nil {
		t.Fatalf("no ProbeMatches: %v", err)
	}
	m, err := parseMessage(reply)
	if err != nil || m.action != actionProbeMatches {
		t.Fatalf("reply %s", reply)
	}
	if !bytes.Contains(reply, []byte("urn:uuid:"+testUUID)) || !bytes.Contains(reply, []byte("pub:Computer")) {
		t.Errorf("ProbeMatches must name the device and its types: %s", reply)
	}

	reply, err = ask(t, cfg.DiscoveryPort, []byte(fmt.Sprintf(resolveTemplate, NewUUID(), testUUID)))
	if err != nil {
		t.Fatalf("no ResolveMatches: %v", err)
	}
	wantAddr := fmt.Sprintf("http://127.0.0.1:%d/%s", cfg.MetadataPort, testUUID)
	if !bytes.Contains(reply, []byte(wantAddr)) {
		t.Fatalf("ResolveMatches must carry %s: %s", wantAddr, reply)
	}

	get := `<s:Envelope xmlns:s="` + nsSOAP + `" xmlns:a="` + nsAddress + `"><s:Header>` +
		`<a:Action>` + actionGet + `</a:Action><a:MessageID>urn:uuid:42</a:MessageID></s:Header><s:Body/></s:Envelope>`
	res, err := http.Post(wantAddr, "application/soap+xml", strings.NewReader(get))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !bytes.Contains(body, []byte("<pub:Computer>AROZTEST/Workgroup:WORKGROUP</pub:Computer>")) {
		t.Errorf("GetResponse %d: %s", res.StatusCode, body)
	}
	if !bytes.Contains(body, []byte("urn:uuid:42")) {
		t.Error("the response must relate to the request")
	}
}

func TestOtherRequestsGetNoAnswer(t *testing.T) {
	_, cfg := startTest(t)
	if _, err := ask(t, cfg.DiscoveryPort, []byte(fmt.Sprintf(resolveTemplate, NewUUID(), NewUUID()))); err == nil {
		t.Error("a Resolve for another device must not be answered")
	}
	id := NewUUID()
	if _, err := ask(t, cfg.DiscoveryPort, []byte(fmt.Sprintf(windowsProbe, id))); err != nil {
		t.Fatal(err)
	}
	if _, err := ask(t, cfg.DiscoveryPort, []byte(fmt.Sprintf(windowsProbe, id))); err == nil {
		t.Error("a repeated message must be answered once")
	}
	res, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/%s", cfg.MetadataPort, testUUID))
	if err == nil {
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("GET: %d", res.StatusCode)
		}
	}
}

func llmnrQueryOf(id uint16, name string, qtype uint16) []byte {
	b := make([]byte, 12)
	binary.BigEndian.PutUint16(b, id)
	binary.BigEndian.PutUint16(b[4:], 1)
	for _, label := range strings.Split(name, ".") {
		b = append(b, byte(len(label)))
		b = append(b, label...)
	}
	b = append(b, 0, byte(qtype>>8), byte(qtype), 0, 1)
	return b
}

func TestLLMNRAnswersOurNameOnly(t *testing.T) {
	_, cfg := startTest(t)
	reply, err := ask(t, cfg.LLMNRPort, llmnrQueryOf(0x1234, "aroztest", dnsTypeA))
	if err != nil {
		t.Fatalf("no answer: %v", err)
	}
	if binary.BigEndian.Uint16(reply) != 0x1234 || binary.BigEndian.Uint16(reply[2:])&0x8000 == 0 {
		t.Fatalf("header %x", reply[:4])
	}
	if binary.BigEndian.Uint16(reply[6:]) != 1 || !bytes.Equal(reply[len(reply)-4:], []byte{127, 0, 0, 1}) {
		t.Errorf("answer %x", reply)
	}

	reply, err = ask(t, cfg.LLMNRPort, llmnrQueryOf(7, "AROZTEST", dnsTypeAAAA))
	if err != nil || binary.BigEndian.Uint16(reply[6:]) != 0 {
		t.Errorf("AAAA must get an empty answer at once: %x %v", reply, err)
	}
	if _, err := ask(t, cfg.LLMNRPort, llmnrQueryOf(8, "OTHERPC", dnsTypeA)); err == nil {
		t.Error("another computer's name must not be answered")
	}
}

func TestParseLLMNR(t *testing.T) {
	q, ok := parseLLMNR(llmnrQueryOf(1, "nas", dnsTypeA))
	if !ok || q.name != "nas" || q.qtype != dnsTypeA {
		t.Errorf("%+v %v", q, ok)
	}
	response := llmnrQueryOf(1, "nas", dnsTypeA)
	response[2] = 0x80
	bad := [][]byte{nil, make([]byte, 11), response, llmnrQueryOf(1, "nas", dnsTypeA)[:15]}
	for i, b := range bad {
		if _, ok := parseLLMNR(b); ok {
			t.Errorf("case %d parsed", i)
		}
	}
}

func TestStartNeedsANameAndUUID(t *testing.T) {
	if _, err := Start(Config{Name: "X"}); err == nil {
		t.Error("expected an error")
	}
	if u := NewUUID(); len(u) != 36 || u[14] != '4' {
		t.Errorf("uuid %s", u)
	}
}

func TestMetadataEscapesTheName(t *testing.T) {
	m := metadata(testUUID, "A<B", "W&G")
	if strings.Contains(m, "A<B") || !strings.Contains(m, "A&lt;B/Workgroup:W&amp;G") {
		t.Errorf("not escaped: %s", m)
	}
}
