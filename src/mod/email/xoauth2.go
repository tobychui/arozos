package email

/*
	xoauth2.go

	The XOAUTH2 SASL mechanism used by Gmail and Microsoft for IMAP and SMTP.
	go-sasl ships the standard OAUTHBEARER but not XOAUTH2, and Microsoft only
	accepts the latter, so it is implemented here.

	Initial response: "user=" user ^A "auth=Bearer " token ^A ^A
	On failure the server sends a base64 JSON challenge; the client must answer
	with an empty response, after which the server sends the tagged failure.
*/

import (
	"encoding/json"
	"fmt"

	"github.com/emersion/go-sasl"
)

type xoauth2Client struct {
	username string
	token    string
	failure  string
}

// newXOAuth2Client returns a SASL client for the XOAUTH2 mechanism.
func newXOAuth2Client(username string, token string) sasl.Client {
	return &xoauth2Client{username: username, token: token}
}

func (c *xoauth2Client) Start() (string, []byte, error) {
	response := "user=" + c.username + "\x01auth=Bearer " + c.token + "\x01\x01"
	return "XOAUTH2", []byte(response), nil
}

func (c *xoauth2Client) Next(challenge []byte) ([]byte, error) {
	//The only challenge XOAUTH2 defines is the error document. Remember it
	//for a better message and send the empty response the protocol expects.
	var detail struct {
		Status  string `json:"status"`
		Schemes string `json:"schemes"`
		Scope   string `json:"scope"`
	}
	if err := json.Unmarshal(challenge, &detail); err == nil && detail.Status != "" {
		c.failure = fmt.Sprintf("token rejected (status %s)", detail.Status)
	}
	return []byte{}, nil
}
