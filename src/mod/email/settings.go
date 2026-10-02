package email

/*
	settings.go

	Per-user preferences of the Mail app and the system-wide configuration an
	administrator manages (OAuth clients, network policy, size limits).
*/

import (
	"strings"
)

// UserSettings are one ArozOS user's Mail preferences.
type UserSettings struct {
	Theme               string   `json:"theme"`         //system | light | dark
	Density             string   `json:"density"`       //comfortable | compact
	ReadingPane         string   `json:"readingPane"`   //right | bottom
	ShowPreview         bool     `json:"showPreview"`   //Snippet line in the message list
	MarkReadDelay       int      `json:"markReadDelay"` //Seconds, -1 = never mark automatically
	RemoteImages        string   `json:"remoteImages"`  //ask | always
	TrustedSenders      []string `json:"trustedSenders"`
	UndoSendSeconds     int      `json:"undoSendSeconds"` //0 sends immediately
	ConfirmDelete       bool     `json:"confirmDelete"`
	DefaultAccount      string   `json:"defaultAccount"`
	ComposeFont         string   `json:"composeFont"`
	ComposeFontSize     string   `json:"composeFontSize"`
	PollMinutes         int      `json:"pollMinutes"`
	Notify              bool     `json:"notify"`
	PageSize            int      `json:"pageSize"`
	AutoCollectContacts bool     `json:"autoCollectContacts"`
	SendShortcut        string   `json:"sendShortcut"` //ctrl-enter | none
}

// DefaultUserSettings are applied to anything a user has not chosen.
func DefaultUserSettings() UserSettings {
	return UserSettings{
		Theme:               "system",
		Density:             "comfortable",
		ReadingPane:         "right",
		ShowPreview:         true,
		MarkReadDelay:       0,
		RemoteImages:        "ask",
		TrustedSenders:      []string{},
		UndoSendSeconds:     5,
		ConfirmDelete:       false,
		ComposeFont:         "",
		ComposeFontSize:     "14px",
		PollMinutes:         2,
		Notify:              true,
		PageSize:            50,
		AutoCollectContacts: true,
		SendShortcut:        "ctrl-enter",
	}
}

// normalise clamps every field into its valid range, so a hand-edited or
// older record can never put the UI into an impossible state.
func (s *UserSettings) normalise() {
	defaults := DefaultUserSettings()
	if !oneOf(s.Theme, "system", "light", "dark") {
		s.Theme = defaults.Theme
	}
	if !oneOf(s.Density, "comfortable", "compact") {
		s.Density = defaults.Density
	}
	if !oneOf(s.ReadingPane, "right", "bottom") {
		s.ReadingPane = defaults.ReadingPane
	}
	if s.MarkReadDelay < -1 || s.MarkReadDelay > 60 {
		s.MarkReadDelay = defaults.MarkReadDelay
	}
	if !oneOf(s.RemoteImages, "ask", "always") {
		s.RemoteImages = defaults.RemoteImages
	}
	if s.TrustedSenders == nil {
		s.TrustedSenders = []string{}
	}
	cleaned := []string{}
	seen := map[string]bool{}
	for _, sender := range s.TrustedSenders {
		sender = strings.ToLower(strings.TrimSpace(sender))
		if sender == "" || seen[sender] {
			continue
		}
		seen[sender] = true
		cleaned = append(cleaned, sender)
	}
	s.TrustedSenders = cleaned
	if s.UndoSendSeconds < 0 || s.UndoSendSeconds > 60 {
		s.UndoSendSeconds = defaults.UndoSendSeconds
	}
	if s.PollMinutes < 1 || s.PollMinutes > 60 {
		s.PollMinutes = defaults.PollMinutes
	}
	if s.PageSize < 10 || s.PageSize > 200 {
		s.PageSize = defaults.PageSize
	}
	if !oneOf(s.SendShortcut, "ctrl-enter", "none") {
		s.SendShortcut = defaults.SendShortcut
	}
	if len(s.ComposeFont) > 120 {
		s.ComposeFont = ""
	}
	if len(s.ComposeFontSize) > 12 {
		s.ComposeFontSize = defaults.ComposeFontSize
	}
}

// IsTrustedSender reports whether remote content of mail from address loads
// without asking: either the exact address or its whole domain is trusted.
func (s *UserSettings) IsTrustedSender(address string) bool {
	address = strings.ToLower(strings.TrimSpace(address))
	if address == "" {
		return false
	}
	domain := ""
	if at := strings.LastIndex(address, "@"); at >= 0 {
		domain = address[at+1:]
	}
	for _, trusted := range s.TrustedSenders {
		if trusted == address {
			return true
		}
		if domain != "" && (trusted == domain || trusted == "@"+domain) {
			return true
		}
	}
	return false
}

// OAuth sign-in flows an administrator can choose.
const (
	FlowRedirect = "redirect" //Popup + redirect back to /Mail/oauth.html (needs HTTPS or localhost)
	FlowDevice   = "device"   //Device code: the user types a code on the provider's site
	FlowLoopback = "loopback" //Desktop-app client: the user pastes the 127.0.0.1 redirect URL back
)

// OAuthClient is an OAuth application registered by the administrator.
type OAuthClient struct {
	Enabled      bool   `json:"enabled"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret,omitempty"` //Sealed at rest, never returned to the browser
	Tenant       string `json:"tenant,omitempty"`       //Microsoft only, defaults to "common"
	Flow         string `json:"flow"`
}

// AdminConfig is the system-wide Mail configuration.
type AdminConfig struct {
	Google            OAuthClient `json:"google"`
	Microsoft         OAuthClient `json:"microsoft"`
	AllowPrivateHosts bool        `json:"allowPrivateHosts"` //Let non-admins reach LAN / loopback servers
	AllowInsecure     bool        `json:"allowInsecure"`     //Let non-admins use unencrypted connections
	MaxAttachmentMB   int         `json:"maxAttachmentMB"`   //Total attachment size per outgoing message
	MaxAccounts       int         `json:"maxAccounts"`       //Per user, 0 = unlimited
}

// AdminConfigView is what the admin settings page receives.
type AdminConfigView struct {
	Google            OAuthClientView `json:"google"`
	Microsoft         OAuthClientView `json:"microsoft"`
	AllowPrivateHosts bool            `json:"allowPrivateHosts"`
	AllowInsecure     bool            `json:"allowInsecure"`
	MaxAttachmentMB   int             `json:"maxAttachmentMB"`
	MaxAccounts       int             `json:"maxAccounts"`
}

// OAuthClientView hides the client secret behind a flag.
type OAuthClientView struct {
	Enabled   bool   `json:"enabled"`
	ClientID  string `json:"clientId"`
	HasSecret bool   `json:"hasSecret"`
	Tenant    string `json:"tenant,omitempty"`
	Flow      string `json:"flow"`
}

func defaultAdminConfig() AdminConfig {
	return AdminConfig{
		Google:          OAuthClient{Flow: FlowRedirect},
		Microsoft:       OAuthClient{Flow: FlowDevice, Tenant: "common"},
		MaxAttachmentMB: 25,
	}
}

func (c *AdminConfig) normalise() {
	if !oneOf(c.Google.Flow, FlowRedirect, FlowLoopback) {
		c.Google.Flow = FlowRedirect
	}
	if !oneOf(c.Microsoft.Flow, FlowRedirect, FlowDevice) {
		c.Microsoft.Flow = FlowDevice
	}
	c.Microsoft.Tenant = strings.TrimSpace(c.Microsoft.Tenant)
	if c.Microsoft.Tenant == "" {
		c.Microsoft.Tenant = "common"
	}
	c.Google.Tenant = ""
	c.Google.ClientID = strings.TrimSpace(c.Google.ClientID)
	c.Microsoft.ClientID = strings.TrimSpace(c.Microsoft.ClientID)
	if c.MaxAttachmentMB <= 0 || c.MaxAttachmentMB > 1024 {
		c.MaxAttachmentMB = 25
	}
	if c.MaxAccounts < 0 {
		c.MaxAccounts = 0
	}
}

func (c *OAuthClient) view() OAuthClientView {
	return OAuthClientView{
		Enabled:   c.Enabled,
		ClientID:  c.ClientID,
		HasSecret: c.ClientSecret != "",
		Tenant:    c.Tenant,
		Flow:      c.Flow,
	}
}

func oneOf(value string, options ...string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}
