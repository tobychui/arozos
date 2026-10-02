package email

/*
	types.go

	Data structures shared by the mail backend and the AGI "email" library.
	Everything that crosses into the browser is JSON tagged; secrets never
	do — Account carries them sealed, AccountInfo is the public view.
*/

// Connection security for a mail server.
const (
	SecuritySSL      = "ssl"      //Implicit TLS (IMAPS 993, SMTPS 465)
	SecuritySTARTTLS = "starttls" //Plain connect followed by STARTTLS (143 / 587)
	SecurityNone     = "none"     //No encryption at all, for LAN test servers only
)

// Authentication methods.
const (
	AuthPassword = "password" //Password or provider app password
	AuthOAuth2   = "oauth2"   //XOAUTH2 with a refresh token from an OAuth sign-in
)

// Folder roles, derived from SPECIAL-USE attributes or well-known names.
const (
	RoleInbox     = "inbox"
	RoleSent      = "sent"
	RoleDrafts    = "drafts"
	RoleTrash     = "trash"
	RoleJunk      = "junk"
	RoleArchive   = "archive"
	RoleAll       = "all"
	RoleFlagged   = "flagged"
	RoleImportant = "important"
)

// Principal is the ArozOS user an operation runs for. Admin widens the
// network policy (see netguard.go); everything else is scoped by Username.
type Principal struct {
	Username string
	Admin    bool
}

// ServerConfig describes one IMAP or SMTP endpoint.
type ServerConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Security string `json:"security"`
	Username string `json:"username"`
}

// Account is a stored mail account. Secret and SMTPSecret are sealed with
// the manager key and must never be handed to the browser.
type Account struct {
	ID            string       `json:"id"`
	Owner         string       `json:"owner"`
	Email         string       `json:"email"`
	DisplayName   string       `json:"displayName"`
	Provider      string       `json:"provider"`
	Color         string       `json:"color"`
	IMAP          ServerConfig `json:"imap"`
	SMTP          ServerConfig `json:"smtp"`
	Auth          string       `json:"auth"`
	OAuthProvider string       `json:"oauthProvider,omitempty"`
	OAuthFlow     string       `json:"oauthFlow,omitempty"` //Device-flow tokens belong to a public client and refresh without a secret
	Secret        string       `json:"secret"`
	SMTPSecret    string       `json:"smtpSecret,omitempty"`
	Signature     string       `json:"signature"`
	ReplyTo       string       `json:"replyTo"`
	SaveSent      string       `json:"saveSent"` //auto | always | never
	Order         int          `json:"order"`
	Created       int64        `json:"created"`
	Updated       int64        `json:"updated"`
	AuthError     string       `json:"authError,omitempty"`

	//Access token of a sign-in that just finished, used to seed the token
	//cache once the account has its id. Never persisted.
	freshAccessToken string
	freshTokenExpiry int64
}

// AccountInfo is the browser-safe view of an Account.
type AccountInfo struct {
	ID              string       `json:"id"`
	Email           string       `json:"email"`
	DisplayName     string       `json:"displayName"`
	Provider        string       `json:"provider"`
	Color           string       `json:"color"`
	IMAP            ServerConfig `json:"imap"`
	SMTP            ServerConfig `json:"smtp"`
	Auth            string       `json:"auth"`
	OAuthProvider   string       `json:"oauthProvider,omitempty"`
	Signature       string       `json:"signature"`
	ReplyTo         string       `json:"replyTo"`
	SaveSent        string       `json:"saveSent"`
	Order           int          `json:"order"`
	HasSecret       bool         `json:"hasSecret"`
	SeparateSMTPKey bool         `json:"separateSmtpPassword"`
	AuthError       string       `json:"authError,omitempty"`
}

// AccountInput is what the browser sends to create or update an account.
// An empty Password on update keeps the stored one.
type AccountInput struct {
	Email         string       `json:"email"`
	DisplayName   string       `json:"displayName"`
	Provider      string       `json:"provider"`
	Color         string       `json:"color"`
	IMAP          ServerConfig `json:"imap"`
	SMTP          ServerConfig `json:"smtp"`
	Auth          string       `json:"auth"`
	Password      string       `json:"password"`
	SMTPPassword  string       `json:"smtpPassword"`
	OAuthState    string       `json:"oauthState"`
	Signature     string       `json:"signature"`
	ReplyTo       string       `json:"replyTo"`
	SaveSent      string       `json:"saveSent"`
	SkipSMTPCheck bool         `json:"skipSmtpCheck"`
}

// Address is a parsed mailbox.
type Address struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Folder is an IMAP mailbox as shown in the sidebar.
type Folder struct {
	Name       string `json:"name"`    //Full mailbox name, e.g. "[Gmail]/Sent Mail"
	Display    string `json:"display"` //Last path segment
	Parent     string `json:"parent"`
	Delimiter  string `json:"delimiter"`
	Depth      int    `json:"depth"`
	Role       string `json:"role"`
	Selectable bool   `json:"selectable"`
	Total      int    `json:"total"`  //-1 when unknown
	Unread     int    `json:"unread"` //-1 when unknown
}

// MessageSummary is one row of a message list.
type MessageSummary struct {
	AccountID      string    `json:"accountId"`
	Folder         string    `json:"folder"`
	UID            uint32    `json:"uid"`
	UIDValidity    uint32    `json:"uidValidity"`
	MessageID      string    `json:"messageId"`
	Subject        string    `json:"subject"`
	From           []Address `json:"from"`
	To             []Address `json:"to"`
	Cc             []Address `json:"cc"`
	Date           int64     `json:"date"`     //Unix ms, from the Date header
	Received       int64     `json:"received"` //Unix ms, IMAP INTERNALDATE
	Size           int64     `json:"size"`
	Seen           bool      `json:"seen"`
	Flagged        bool      `json:"flagged"`
	Answered       bool      `json:"answered"`
	Forwarded      bool      `json:"forwarded"`
	Draft          bool      `json:"draft"`
	HasAttachments bool      `json:"hasAttachments"`
	Priority       int       `json:"priority"` //1 high, 3 normal, 5 low
	Preview        string    `json:"preview"`
	Labels         []string  `json:"labels"`
	SnoozedUntil   int64     `json:"snoozedUntil,omitempty"` //Unix ms while snoozed
}

// MessageList is a page of messages.
type MessageList struct {
	Total           int              `json:"total"`
	Page            int              `json:"page"`
	PageSize        int              `json:"pageSize"`
	Messages        []MessageSummary `json:"messages"`
	SortUnsupported bool             `json:"sortUnsupported,omitempty"`
	Errors          []AccountError   `json:"errors,omitempty"`
}

// AccountError reports one account failing inside a multi-account call, so a
// broken account never blanks the unified views.
type AccountError struct {
	AccountID  string `json:"accountId"`
	Email      string `json:"email"`
	Error      string `json:"error"`
	AuthFailed bool   `json:"authFailed"`
}

// Attachment describes one downloadable part.
type Attachment struct {
	ID          string `json:"id"` //IMAP section path, e.g. "2" or "1.3"
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	Inline      bool   `json:"inline"`
	ContentID   string `json:"contentId,omitempty"`
}

// AuthResults summarises the Authentication-Results header added by the
// receiving provider.
type AuthResults struct {
	SPF   string `json:"spf"`
	DKIM  string `json:"dkim"`
	DMARC string `json:"dmarc"`
}

// Message is a fully loaded message for the reading pane.
type Message struct {
	MessageSummary
	ReplyTo          []Address    `json:"replyTo"`
	Bcc              []Address    `json:"bcc"`
	InReplyTo        string       `json:"inReplyTo"`
	References       []string     `json:"references"`
	HTML             string       `json:"html"` //Sanitised; empty for plain-text mail
	Text             string       `json:"text"`
	HasRemoteContent bool         `json:"hasRemoteContent"`
	RemoteAllowed    bool         `json:"remoteAllowed"`
	Attachments      []Attachment `json:"attachments"`
	ListUnsubscribe  string       `json:"listUnsubscribe,omitempty"`
	ReadReceiptTo    string       `json:"readReceiptTo,omitempty"`
	Auth             *AuthResults `json:"auth,omitempty"`
	Signed           bool         `json:"signed"`
	Encrypted        bool         `json:"encrypted"`
	Calendar         bool         `json:"calendar"`
}

// RawMessage is the original RFC 822 source of a message.
type RawMessage struct {
	Filename string
	Data     []byte
}

// PartData is a decoded attachment.
type PartData struct {
	Filename    string
	ContentType string
	Data        []byte
}
