package email

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
)

const sampleAutoconfig = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.org">
    <domain>example.org</domain>
    <displayName>Example Mail</displayName>
    <incomingServer type="pop3">
      <hostname>pop.example.org</hostname><port>995</port><socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.example.org</hostname><port>143</port><socketType>STARTTLS</socketType>
      <username>%EMAILLOCALPART%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.example.org</hostname><port>993</port><socketType>SSL</socketType>
      <username>%EMAILLOCALPART%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.org</hostname><port>587</port><socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

func TestParseAutoconfig(t *testing.T) {
	result := parseAutoconfig([]byte(sampleAutoconfig), "jane@example.org")
	if result == nil {
		t.Fatalf("parseAutoconfig returned nil")
	}
	if result.IMAP != (ServerConfig{Host: "imap.example.org", Port: 993, Security: SecuritySSL, Username: "jane"}) {
		t.Errorf("IMAP = %+v", result.IMAP)
	}
	if result.SMTP != (ServerConfig{Host: "smtp.example.org", Port: 587, Security: SecuritySTARTTLS, Username: "jane@example.org"}) {
		t.Errorf("SMTP = %+v", result.SMTP)
	}
	if result.Name != "Example Mail" {
		t.Errorf("name = %q", result.Name)
	}
	if parseAutoconfig([]byte("<html>not found</html>"), "a@b.c") != nil {
		t.Errorf("garbage should not parse")
	}
}

type staticTransport struct {
	responses map[string]string
}

func (s *staticTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	for prefix, body := range s.responses {
		if strings.HasPrefix(request.URL.String(), prefix) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
		}
	}
	return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("")), Request: request}, nil
}

func TestDiscover(t *testing.T) {
	originalMX := mxLookup
	originalSRV := srvLookup
	defer func() { mxLookup = originalMX; srvLookup = originalSRV }()
	mxLookup = func(ctx context.Context, domain string) ([]*net.MX, error) {
		switch domain {
		case "contoso.test":
			return []*net.MX{{Host: "contoso-test.mail.protection.outlook.com.", Pref: 0}}, nil
		case "workspace.test":
			return []*net.MX{{Host: "alt2.aspmx.l.google.com.", Pref: 10}, {Host: "aspmx.l.google.com.", Pref: 1}}, nil
		}
		return nil, errors.New("no MX")
	}
	srvLookup = func(ctx context.Context, service string, domain string) ([]*net.SRV, error) {
		if domain == "srv.test" {
			switch service {
			case "imaps":
				return []*net.SRV{{Target: "mail.srv.test.", Port: 993}}, nil
			case "submission":
				return []*net.SRV{{Target: "mail.srv.test.", Port: 587}}, nil
			}
		}
		return nil, errors.New("no SRV")
	}

	manager, err := NewManager(Options{
		DataDir: t.TempDir(), DisableBackground: true,
		HTTPClient: &http.Client{Transport: &staticTransport{responses: map[string]string{
			"https://autoconfig.thunderbird.net/v1.1/example.org": sampleAutoconfig,
		}}},
	})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer manager.Close()

	tests := []struct {
		address  string
		provider string
		source   string
		imapHost string
	}{
		{"me@gmail.com", "gmail", "preset", "imap.gmail.com"},
		{"ceo@contoso.test", "office365", "mx", "outlook.office365.com"},
		{"me@workspace.test", "gmail", "mx", "imap.gmail.com"},
		{"jane@example.org", "custom", "ispdb", "imap.example.org"},
		{"me@srv.test", "custom", "srv", "mail.srv.test"},
	}
	for _, test := range tests {
		t.Run(test.address, func(t *testing.T) {
			result, err := manager.Discover(testContext(t), testAdmin, test.address)
			if err != nil {
				t.Fatalf("Discover: %v", err)
			}
			if result.Provider != test.provider || result.Source != test.source || result.IMAP.Host != test.imapHost {
				t.Errorf("Discover = %+v", result)
			}
		})
	}

	if _, err := manager.Discover(testContext(t), testAdmin, "not-an-address"); err == nil {
		t.Errorf("an incomplete address was accepted")
	}
}
