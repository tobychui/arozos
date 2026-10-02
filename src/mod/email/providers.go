package email

/*
	providers.go

	Known mail providers. A preset fills in server settings, tells the UI
	which sign-in methods apply and explains how to obtain an app password,
	which is what Gmail, Yahoo, iCloud and AOL require for third-party clients.
*/

import (
	"strings"
)

// Preset describes a mail provider the account wizard knows.
type Preset struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Icon          string       `json:"icon"` //Semantic UI icon name
	Color         string       `json:"color"`
	Domains       []string     `json:"domains"`
	IMAP          ServerConfig `json:"imap"`
	SMTP          ServerConfig `json:"smtp"`
	OAuth         string       `json:"oauth,omitempty"` //google | microsoft when XOAUTH2 is supported
	PasswordLabel string       `json:"passwordLabel"`
	PasswordHelp  string       `json:"passwordHelp"`
	PasswordURL   string       `json:"passwordUrl,omitempty"`
	UsernameStyle string       `json:"usernameStyle"` //email | localpart
	SaveSent      bool         `json:"saveSent"`      //The client must append sent mail to the Sent folder itself
	Hidden        bool         `json:"hidden"`        //Matched by domain / MX only, not shown as a tile

	mxSuffixes     []string //MX host suffixes that identify custom domains hosted here
	domainPrefixes []string //Prefixes such as "hotmail." covering regional domains
}

var presets = []Preset{
	{
		ID:    "gmail",
		Name:  "Gmail",
		Icon:  "google",
		Color: "#ea4335",
		Domains: []string{
			"gmail.com", "googlemail.com",
		},
		IMAP:          ServerConfig{Host: "imap.gmail.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.gmail.com", Port: 465, Security: SecuritySSL},
		OAuth:         "google",
		PasswordLabel: "App password",
		PasswordHelp:  "Google does not accept your normal password here. Turn on 2-Step Verification for your Google account, then create a 16 character app password and paste it below.",
		PasswordURL:   "https://myaccount.google.com/apppasswords",
		UsernameStyle: "email",
		SaveSent:      false,
		mxSuffixes:    []string{"google.com", "googlemail.com"},
	},
	{
		ID:    "outlook",
		Name:  "Outlook.com / Hotmail",
		Icon:  "microsoft",
		Color: "#0078d4",
		Domains: []string{
			"outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
		},
		IMAP:          ServerConfig{Host: "outlook.office365.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp-mail.outlook.com", Port: 587, Security: SecuritySTARTTLS},
		OAuth:         "microsoft",
		PasswordLabel: "App password",
		PasswordHelp:  "Microsoft requires modern sign-in for Outlook.com, Hotmail and Live accounts, so use \"Sign in with Microsoft\" when it is available. A password only works if your account still allows app passwords.",
		PasswordURL:   "https://account.live.com/proofs/AppPassword",
		UsernameStyle: "email",
		SaveSent:      false,
		domainPrefixes: []string{
			"outlook.", "hotmail.", "live.",
		},
	},
	{
		ID:            "office365",
		Name:          "Microsoft 365 (work or school)",
		Icon:          "windows",
		Color:         "#d83b01",
		Domains:       []string{},
		IMAP:          ServerConfig{Host: "outlook.office365.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.office365.com", Port: 587, Security: SecuritySTARTTLS},
		OAuth:         "microsoft",
		PasswordLabel: "Password",
		PasswordHelp:  "Microsoft 365 organisations normally require \"Sign in with Microsoft\". Your IT administrator must also allow IMAP and SMTP for your mailbox.",
		UsernameStyle: "email",
		SaveSent:      false,
		mxSuffixes:    []string{"mail.protection.outlook.com", "outlook.com"},
	},
	{
		ID:    "yahoo",
		Name:  "Yahoo Mail",
		Icon:  "yahoo",
		Color: "#6001d2",
		Domains: []string{
			"yahoo.com", "ymail.com", "rocketmail.com",
		},
		IMAP:           ServerConfig{Host: "imap.mail.yahoo.com", Port: 993, Security: SecuritySSL},
		SMTP:           ServerConfig{Host: "smtp.mail.yahoo.com", Port: 465, Security: SecuritySSL},
		PasswordLabel:  "App password",
		PasswordHelp:   "Yahoo requires an app password for mail apps. Open Account Security, choose \"Generate app password\" and paste the result below.",
		PasswordURL:    "https://login.yahoo.com/account/security",
		UsernameStyle:  "email",
		SaveSent:       true,
		mxSuffixes:     []string{"yahoodns.net"},
		domainPrefixes: []string{"yahoo."},
	},
	{
		ID:    "icloud",
		Name:  "iCloud Mail",
		Icon:  "apple",
		Color: "#3693f3",
		Domains: []string{
			"icloud.com", "me.com", "mac.com",
		},
		IMAP:          ServerConfig{Host: "imap.mail.me.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.mail.me.com", Port: 587, Security: SecuritySTARTTLS},
		PasswordLabel: "App-specific password",
		PasswordHelp:  "Apple requires an app-specific password. Sign in to your Apple Account, open Sign-In and Security, choose App-Specific Passwords and generate one for ArozOS Mail.",
		PasswordURL:   "https://account.apple.com/account/manage",
		UsernameStyle: "email",
		SaveSent:      true,
		mxSuffixes:    []string{"mail.icloud.com"},
	},
	{
		ID:            "aol",
		Name:          "AOL Mail",
		Icon:          "envelope",
		Color:         "#31459b",
		Domains:       []string{"aol.com", "aim.com"},
		IMAP:          ServerConfig{Host: "imap.aol.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.aol.com", Port: 465, Security: SecuritySSL},
		PasswordLabel: "App password",
		PasswordHelp:  "AOL requires an app password. Open Account Security and generate an app password for this device.",
		PasswordURL:   "https://login.aol.com/account/security",
		UsernameStyle: "email",
		SaveSent:      true,
	},
	{
		ID:            "zoho",
		Name:          "Zoho Mail",
		Icon:          "envelope",
		Color:         "#e42527",
		Domains:       []string{"zoho.com", "zohomail.com"},
		IMAP:          ServerConfig{Host: "imap.zoho.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.zoho.com", Port: 465, Security: SecuritySSL},
		PasswordLabel: "Password",
		PasswordHelp:  "Enable IMAP access in Zoho Mail settings first. Accounts with two-factor authentication need an application-specific password.",
		UsernameStyle: "email",
		SaveSent:      true,
		mxSuffixes:    []string{"zoho.com"},
		Hidden:        true,
	},
	{
		ID:            "fastmail",
		Name:          "Fastmail",
		Icon:          "envelope",
		Color:         "#0067b9",
		Domains:       []string{"fastmail.com", "fastmail.fm"},
		IMAP:          ServerConfig{Host: "imap.fastmail.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.fastmail.com", Port: 465, Security: SecuritySSL},
		PasswordLabel: "App password",
		PasswordHelp:  "Fastmail requires an app password. Create one under Settings, Privacy & Security, Integrations.",
		PasswordURL:   "https://app.fastmail.com/settings/security/integrations",
		UsernameStyle: "email",
		SaveSent:      true,
		mxSuffixes:    []string{"messagingengine.com"},
		Hidden:        true,
	},
	{
		ID:            "qq",
		Name:          "QQ Mail",
		Icon:          "envelope",
		Color:         "#1aad19",
		Domains:       []string{"qq.com", "foxmail.com", "vip.qq.com"},
		IMAP:          ServerConfig{Host: "imap.qq.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.qq.com", Port: 465, Security: SecuritySSL},
		PasswordLabel: "Authorization code",
		PasswordHelp:  "Enable IMAP/SMTP in QQ Mail settings and use the generated authorization code instead of your QQ password.",
		UsernameStyle: "email",
		SaveSent:      true,
		mxSuffixes:    []string{"qq.com"},
		Hidden:        true,
	},
	{
		ID:            "netease",
		Name:          "NetEase Mail",
		Icon:          "envelope",
		Color:         "#d0021b",
		Domains:       []string{"163.com", "126.com", "yeah.net"},
		IMAP:          ServerConfig{Host: "imap.163.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.163.com", Port: 465, Security: SecuritySSL},
		PasswordLabel: "Authorization code",
		PasswordHelp:  "Enable IMAP/SMTP in your mailbox settings and use the client authorization code instead of your login password.",
		UsernameStyle: "email",
		SaveSent:      true,
		Hidden:        true,
	},
	{
		ID:            "yandex",
		Name:          "Yandex Mail",
		Icon:          "envelope",
		Color:         "#fc3f1d",
		Domains:       []string{"yandex.com", "yandex.ru", "ya.ru"},
		IMAP:          ServerConfig{Host: "imap.yandex.com", Port: 993, Security: SecuritySSL},
		SMTP:          ServerConfig{Host: "smtp.yandex.com", Port: 465, Security: SecuritySSL},
		PasswordLabel: "App password",
		PasswordHelp:  "Yandex requires an app password for mail clients. Create one in your Yandex ID security settings.",
		PasswordURL:   "https://id.yandex.com/security/app-passwords",
		UsernameStyle: "email",
		SaveSent:      true,
		mxSuffixes:    []string{"yandex.net", "yandex.ru"},
		Hidden:        true,
	},
}

// customPreset is used for any server the wizard does not know.
var customPreset = Preset{
	ID:            "custom",
	Name:          "Other mail account",
	Icon:          "server",
	Color:         "#5b6474",
	Domains:       []string{},
	PasswordLabel: "Password",
	PasswordHelp:  "Use the password of your mailbox. If your provider uses two-factor authentication you may need an app password.",
	UsernameStyle: "email",
	SaveSent:      true,
}

// Presets returns every known provider, the generic one last.
func Presets() []Preset {
	results := make([]Preset, 0, len(presets)+1)
	results = append(results, presets...)
	results = append(results, customPreset)
	return results
}

// PresetByID finds a preset by its identifier.
func PresetByID(id string) (Preset, bool) {
	for _, preset := range presets {
		if preset.ID == id {
			return preset, true
		}
	}
	if id == customPreset.ID {
		return customPreset, true
	}
	return Preset{}, false
}

// presetForDomain matches the domain of an address against the known
// consumer domains (gmail.com, hotmail.co.uk, yahoo.co.jp, …).
func presetForDomain(domain string) (Preset, bool) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	if domain == "" {
		return Preset{}, false
	}
	for _, preset := range presets {
		for _, known := range preset.Domains {
			if domain == known {
				return preset, true
			}
		}
		for _, prefix := range preset.domainPrefixes {
			if strings.HasPrefix(domain, prefix) {
				return preset, true
			}
		}
	}
	return Preset{}, false
}

// presetForMX identifies a hosted custom domain from one of its MX hosts.
func presetForMX(mxHost string) (Preset, bool) {
	mxHost = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(mxHost), "."))
	if mxHost == "" {
		return Preset{}, false
	}
	for _, preset := range presets {
		for _, suffix := range preset.mxSuffixes {
			if mxHost == suffix || strings.HasSuffix(mxHost, "."+suffix) {
				return preset, true
			}
		}
	}
	return Preset{}, false
}

// presetSavesSent reports whether a client must append sent mail to the Sent
// folder itself for this provider (Gmail and Outlook file it server-side).
func presetSavesSent(providerID string) bool {
	if preset, ok := PresetByID(providerID); ok {
		return preset.SaveSent
	}
	return true
}

// usernameFor applies the preset username style to an address.
func usernameFor(style string, address string) string {
	if style == "localpart" {
		if at := strings.LastIndex(address, "@"); at > 0 {
			return address[:at]
		}
	}
	return address
}

// domainOf returns the lower-cased domain of an address.
func domainOf(address string) string {
	address = strings.TrimSpace(address)
	at := strings.LastIndex(address, "@")
	if at < 0 || at == len(address)-1 {
		return ""
	}
	return strings.ToLower(address[at+1:])
}

// authHintFor returns the advice shown when a login with a password fails.
func authHintFor(providerID string) string {
	preset, ok := PresetByID(providerID)
	if !ok {
		return ""
	}
	switch preset.ID {
	case "gmail":
		return "Gmail only accepts an app password (or Sign in with Google). Create one at myaccount.google.com/apppasswords after enabling 2-Step Verification."
	case "outlook", "office365":
		return "Microsoft accounts need \"Sign in with Microsoft\". Basic passwords are rejected for most Outlook, Hotmail and Microsoft 365 mailboxes."
	case "yahoo", "aol":
		return "Use an app password generated in your account security settings, not your normal password."
	case "icloud":
		return "iCloud needs an app-specific password generated in your Apple Account settings."
	case "qq", "netease":
		return "Use the authorization code from your mailbox settings and make sure IMAP/SMTP is enabled."
	}
	return preset.PasswordHelp
}
