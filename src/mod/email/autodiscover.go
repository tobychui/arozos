package email

/*
	autodiscover.go

	Works out server settings from an email address, the way Thunderbird does:

	  1. known consumer domains (gmail.com, outlook.com, icloud.com, …)
	  2. MX records pointing at a known host (Google Workspace, Microsoft 365,
	     iCloud custom domains, Zoho, Fastmail, …)
	  3. the Thunderbird ISPDB (autoconfig.thunderbird.net)
	  4. the domain's own autoconfig document
	  5. RFC 6186 SRV records
	  6. probing imap./mail./smtp. host names

	Lookups against the user's domain go through the guarded HTTP client so a
	crafted domain cannot make ArozOS fetch LAN addresses.
*/

import (
	"context"
	"encoding/xml"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// DiscoverResult is the suggested configuration for an address.
type DiscoverResult struct {
	Email    string       `json:"email"`
	Provider string       `json:"provider"`
	Name     string       `json:"name"`
	IMAP     ServerConfig `json:"imap"`
	SMTP     ServerConfig `json:"smtp"`
	OAuth    string       `json:"oauth,omitempty"`
	Source   string       `json:"source"` //preset | mx | ispdb | autoconfig | srv | probe | guess
	Verified bool         `json:"verified"`
}

// mxLookup and srvLookup are swapped by tests.
var mxLookup = func(ctx context.Context, domain string) ([]*net.MX, error) {
	return net.DefaultResolver.LookupMX(ctx, domain)
}
var srvLookup = func(ctx context.Context, service string, domain string) ([]*net.SRV, error) {
	_, records, err := net.DefaultResolver.LookupSRV(ctx, service, "tcp", domain)
	return records, err
}

// Discover suggests server settings for an address.
func (m *Manager) Discover(ctx context.Context, p Principal, address string) (*DiscoverResult, error) {
	address = strings.TrimSpace(address)
	domain := domainOf(address)
	if domain == "" || strings.ContainsAny(domain, " /\\") {
		return nil, errPleaseEnterAddress
	}

	fromPreset := func(preset Preset, source string) *DiscoverResult {
		result := &DiscoverResult{
			Email: address, Provider: preset.ID, Name: preset.Name, IMAP: preset.IMAP, SMTP: preset.SMTP,
			OAuth: preset.OAuth, Source: source, Verified: true,
		}
		result.IMAP.Username = usernameFor(preset.UsernameStyle, address)
		result.SMTP.Username = usernameFor(preset.UsernameStyle, address)
		return result
	}

	if preset, ok := presetForDomain(domain); ok {
		return fromPreset(preset, "preset"), nil
	}

	lookupCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	if records, err := mxLookup(lookupCtx, domain); err == nil {
		sort.Slice(records, func(i, j int) bool { return records[i].Pref < records[j].Pref })
		for _, record := range records {
			if preset, ok := presetForMX(record.Host); ok {
				return fromPreset(preset, "mx"), nil
			}
		}
	}

	if result := m.discoverAutoconfig(ctx, p, address, domain); result != nil {
		return result, nil
	}
	if result := discoverSRV(ctx, address, domain); result != nil {
		return result, nil
	}
	return m.discoverByProbing(ctx, p, address, domain), nil
}

var errPleaseEnterAddress = &discoverError{"please enter a complete email address"}

type discoverError struct{ message string }

func (e *discoverError) Error() string { return e.message }

// Thunderbird autoconfig document (subset).
type autoconfigDocument struct {
	Providers []struct {
		ID          string             `xml:"id,attr"`
		DisplayName string             `xml:"displayName"`
		Incoming    []autoconfigServer `xml:"incomingServer"`
		Outgoing    []autoconfigServer `xml:"outgoingServer"`
	} `xml:"emailProvider"`
}

type autoconfigServer struct {
	Type           string   `xml:"type,attr"`
	Hostname       string   `xml:"hostname"`
	Port           int      `xml:"port"`
	SocketType     string   `xml:"socketType"`
	Username       string   `xml:"username"`
	Authentication []string `xml:"authentication"`
}

func (m *Manager) discoverAutoconfig(ctx context.Context, p Principal, address string, domain string) *DiscoverResult {
	type source struct {
		url     string
		guarded bool
		name    string
	}
	sources := []source{
		{url: "https://autoconfig.thunderbird.net/v1.1/" + url.PathEscape(domain), name: "ispdb"},
		{url: "https://autoconfig." + domain + "/mail/config-v1.1.xml?emailaddress=" + url.QueryEscape(address), guarded: true, name: "autoconfig"},
		{url: "https://" + domain + "/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=" + url.QueryEscape(address), guarded: true, name: "autoconfig"},
	}

	results := make([]*DiscoverResult, len(sources))
	var wg sync.WaitGroup
	for index, src := range sources {
		wg.Add(1)
		go func(index int, src source) {
			defer wg.Done()
			client := m.options.HTTPClient
			if client == nil {
				if src.guarded {
					client = guardedHTTPClient(m.allowPrivate(p), 6*time.Second)
				} else {
					client = &http.Client{Timeout: 6 * time.Second}
				}
			}
			requestCtx, cancel := context.WithTimeout(ctx, 7*time.Second)
			defer cancel()
			request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, src.url, nil)
			if err != nil {
				return
			}
			response, err := client.Do(request)
			if err != nil {
				return
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				return
			}
			body, err := io.ReadAll(io.LimitReader(response.Body, 256*1024))
			if err != nil {
				return
			}
			if result := parseAutoconfig(body, address); result != nil {
				result.Source = src.name
				results[index] = result
			}
		}(index, src)
	}
	wg.Wait()
	for _, result := range results {
		if result != nil {
			return result
		}
	}
	return nil
}

// parseAutoconfig reads a Thunderbird autoconfig XML document.
func parseAutoconfig(body []byte, address string) *DiscoverResult {
	document := autoconfigDocument{}
	if err := xml.Unmarshal(body, &document); err != nil || len(document.Providers) == 0 {
		return nil
	}
	provider := document.Providers[0]

	pick := func(servers []autoconfigServer, wantType string) (ServerConfig, bool) {
		best := ServerConfig{}
		bestRank := -1
		for _, server := range servers {
			if !strings.EqualFold(server.Type, wantType) || server.Hostname == "" {
				continue
			}
			security := map[string]string{"ssl": SecuritySSL, "tls": SecuritySSL, "starttls": SecuritySTARTTLS, "plain": SecurityNone}[strings.ToLower(server.SocketType)]
			if security == "" {
				continue
			}
			rank := map[string]int{SecuritySSL: 3, SecuritySTARTTLS: 2, SecurityNone: 0}[security]
			//Skip servers that only offer OAuth we cannot do with a password
			if rank > bestRank {
				bestRank = rank
				best = ServerConfig{
					Host:     substituteAutoconfig(server.Hostname, address),
					Port:     server.Port,
					Security: security,
					Username: substituteAutoconfig(server.Username, address),
				}
			}
		}
		return best, bestRank >= 0
	}

	imapServer, ok := pick(provider.Incoming, "imap")
	if !ok {
		return nil
	}
	smtpServer, ok := pick(provider.Outgoing, "smtp")
	if !ok {
		return nil
	}
	if imapServer.Port == 0 {
		imapServer.Port = map[string]int{SecuritySSL: 993, SecuritySTARTTLS: 143, SecurityNone: 143}[imapServer.Security]
	}
	if smtpServer.Port == 0 {
		smtpServer.Port = map[string]int{SecuritySSL: 465, SecuritySTARTTLS: 587, SecurityNone: 25}[smtpServer.Security]
	}
	if imapServer.Username == "" {
		imapServer.Username = address
	}
	if smtpServer.Username == "" {
		smtpServer.Username = address
	}
	name := strings.TrimSpace(provider.DisplayName)
	result := &DiscoverResult{
		Email: address, Provider: "custom", Name: name, IMAP: imapServer, SMTP: smtpServer, Verified: true,
	}
	if detected := providerForServer(imapServer.Host); detected != "" {
		result.Provider = detected
		if preset, ok := PresetByID(detected); ok {
			result.OAuth = preset.OAuth
		}
	}
	return result
}

func substituteAutoconfig(value string, address string) string {
	local := address
	if at := strings.LastIndex(address, "@"); at >= 0 {
		local = address[:at]
	}
	value = strings.ReplaceAll(value, "%EMAILADDRESS%", address)
	value = strings.ReplaceAll(value, "%EMAILLOCALPART%", local)
	value = strings.ReplaceAll(value, "%EMAILDOMAIN%", domainOf(address))
	return strings.TrimSpace(value)
}

// discoverSRV reads RFC 6186 service records.
func discoverSRV(ctx context.Context, address string, domain string) *DiscoverResult {
	lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	first := func(service string) *net.SRV {
		records, err := srvLookup(lookupCtx, service, domain)
		if err != nil || len(records) == 0 || records[0].Target == "." || records[0].Target == "" {
			return nil
		}
		return records[0]
	}

	result := &DiscoverResult{Email: address, Provider: "custom", Source: "srv", Verified: true}
	if record := first("imaps"); record != nil {
		result.IMAP = ServerConfig{Host: strings.TrimSuffix(record.Target, "."), Port: int(record.Port), Security: SecuritySSL, Username: address}
	} else if record := first("imap"); record != nil {
		result.IMAP = ServerConfig{Host: strings.TrimSuffix(record.Target, "."), Port: int(record.Port), Security: SecuritySTARTTLS, Username: address}
	} else {
		return nil
	}
	if record := first("submissions"); record != nil {
		result.SMTP = ServerConfig{Host: strings.TrimSuffix(record.Target, "."), Port: int(record.Port), Security: SecuritySSL, Username: address}
	} else if record := first("submission"); record != nil {
		result.SMTP = ServerConfig{Host: strings.TrimSuffix(record.Target, "."), Port: int(record.Port), Security: SecuritySTARTTLS, Username: address}
	} else {
		return nil
	}
	return result
}

// discoverByProbing tries the conventional host names and ports.
func (m *Manager) discoverByProbing(ctx context.Context, p Principal, address string, domain string) *DiscoverResult {
	allowPrivate := m.allowPrivate(p)
	type candidate struct {
		host     string
		port     int
		security string
	}
	probe := func(candidates []candidate) (candidate, bool) {
		found := make([]bool, len(candidates))
		var wg sync.WaitGroup
		for index, item := range candidates {
			wg.Add(1)
			go func(index int, item candidate) {
				defer wg.Done()
				probeCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
				defer cancel()
				conn, err := dialGuarded(probeCtx, item.host, item.port, allowPrivate)
				if err == nil {
					conn.Close()
					found[index] = true
				}
			}(index, item)
		}
		wg.Wait()
		for index, ok := range found {
			if ok {
				return candidates[index], true
			}
		}
		return candidate{}, false
	}

	imapCandidates := []candidate{
		{"imap." + domain, 993, SecuritySSL}, {"mail." + domain, 993, SecuritySSL},
		{"imap." + domain, 143, SecuritySTARTTLS}, {"mail." + domain, 143, SecuritySTARTTLS},
	}
	smtpCandidates := []candidate{
		{"smtp." + domain, 465, SecuritySSL}, {"mail." + domain, 465, SecuritySSL},
		{"smtp." + domain, 587, SecuritySTARTTLS}, {"mail." + domain, 587, SecuritySTARTTLS},
	}

	result := &DiscoverResult{Email: address, Provider: "custom", Source: "guess"}
	imapFound, imapOK := probe(imapCandidates)
	smtpFound, smtpOK := probe(smtpCandidates)
	if imapOK {
		result.IMAP = ServerConfig{Host: imapFound.host, Port: imapFound.port, Security: imapFound.security, Username: address}
	} else {
		result.IMAP = ServerConfig{Host: "imap." + domain, Port: 993, Security: SecuritySSL, Username: address}
	}
	if smtpOK {
		result.SMTP = ServerConfig{Host: smtpFound.host, Port: smtpFound.port, Security: smtpFound.security, Username: address}
	} else {
		result.SMTP = ServerConfig{Host: "smtp." + domain, Port: 465, Security: SecuritySSL, Username: address}
	}
	if imapOK && smtpOK {
		result.Source = "probe"
		result.Verified = true
	}
	return result
}
