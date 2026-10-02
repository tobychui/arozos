package email

/*
	compose.go

	Building outgoing messages.

	Structure produced (parts only appear when needed):

	  multipart/mixed
	  ├─ multipart/alternative
	  │  ├─ text/plain                (generated from the HTML when not given)
	  │  └─ multipart/related
	  │     ├─ text/html
	  │     └─ image/* (Content-ID)   (pasted images, data: URIs in the editor)
	  └─ attachments

	Text parts are quoted-printable UTF-8 and attachments base64, so the
	message is 7-bit clean and survives any relay.
*/

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/mail"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	gomessage "github.com/emersion/go-message"
	gomail "github.com/emersion/go-message/mail"
)

// ComposeAttachment is a file attached by the user. The AGI layer resolves
// ArozOS paths and supplies Open; Data is used by tests and small payloads.
type ComposeAttachment struct {
	Name        string
	ContentType string
	Size        int64
	Open        func() (io.ReadCloser, error)
	Data        []byte
}

// ForwardedPart re-attaches an attachment of an existing message (forward,
// or reopening a draft) straight from the server.
type ForwardedPart struct {
	AccountID string `json:"accountId"`
	Folder    string `json:"folder"`
	UID       uint32 `json:"uid"`
	PartID    string `json:"partId"`
}

// ComposeRequest is a message from the composer.
type ComposeRequest struct {
	AccountID      string          `json:"accountId"`
	FromName       string          `json:"fromName"`
	To             []string        `json:"to"`
	Cc             []string        `json:"cc"`
	Bcc            []string        `json:"bcc"`
	ReplyTo        string          `json:"replyTo"`
	Subject        string          `json:"subject"`
	HTML           string          `json:"html"`
	Text           string          `json:"text"`
	PlainOnly      bool            `json:"plainOnly"`
	Priority       string          `json:"priority"` //high | normal | low
	ReadReceipt    bool            `json:"readReceipt"`
	InReplyTo      string          `json:"inReplyTo"`
	References     []string        `json:"references"`
	ReplyMode      string          `json:"replyMode"` //reply | forward
	OriginalFolder string          `json:"originalFolder"`
	OriginalUID    uint32          `json:"originalUid"`
	DraftFolder    string          `json:"draftFolder"`
	DraftUID       uint32          `json:"draftUid"`
	Forwarded      []ForwardedPart `json:"forwarded"`
	SendAt         int64           `json:"sendAt"`      //Unix ms, 0 sends now
	UndoSeconds    int             `json:"undoSeconds"` //Delay that allows "Undo"

	Attachments []ComposeAttachment `json:"-"`
}

// builtMessage is a rendered message ready for SMTP or APPEND.
type builtMessage struct {
	raw        []byte
	messageID  string
	from       string
	recipients []string
	bccHeader  string //"Bcc: ..." line added to the Sent copy only
	date       time.Time
}

var dataImagePattern = regexp.MustCompile(`(?i)(<img\b[^>]*?\bsrc\s*=\s*["'])data:(image/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)(["'])`)

// parseRecipients validates a recipient list, accepting "Name <a@b>",
// bare addresses and comma / semicolon separated strings.
func parseRecipients(values []string) ([]*mail.Address, error) {
	results := []*mail.Address{}
	seen := map[string]bool{}
	for _, value := range values {
		for _, piece := range splitAddressList(value) {
			piece = strings.TrimSpace(piece)
			if piece == "" {
				continue
			}
			address, err := mail.ParseAddress(piece)
			if err != nil {
				return nil, fmt.Errorf("%q is not a valid email address", piece)
			}
			key := strings.ToLower(address.Address)
			if seen[key] {
				continue
			}
			seen[key] = true
			results = append(results, address)
		}
	}
	return results, nil
}

// splitAddressList splits on commas and semicolons outside quotes / brackets.
func splitAddressList(value string) []string {
	parts := []string{}
	var current strings.Builder
	inQuotes, inAngle := false, false
	for _, r := range value {
		switch {
		case r == '"':
			inQuotes = !inQuotes
		case r == '<' && !inQuotes:
			inAngle = true
		case r == '>' && !inQuotes:
			inAngle = false
		case (r == ',' || r == ';') && !inQuotes && !inAngle:
			parts = append(parts, current.String())
			current.Reset()
			continue
		}
		current.WriteRune(r)
	}
	parts = append(parts, current.String())
	return parts
}

// buildMessage renders a compose request. forDraft keeps Bcc in the headers
// and allows an empty recipient list.
func (m *Manager) buildMessage(ctx context.Context, p Principal, account *Account, request *ComposeRequest, forDraft bool) (*builtMessage, error) {
	to, err := parseRecipients(request.To)
	if err != nil {
		return nil, err
	}
	cc, err := parseRecipients(request.Cc)
	if err != nil {
		return nil, err
	}
	bcc, err := parseRecipients(request.Bcc)
	if err != nil {
		return nil, err
	}
	if !forDraft && len(to)+len(cc)+len(bcc) == 0 {
		return nil, errors.New("add at least one recipient")
	}
	if len(to)+len(cc)+len(bcc) > 500 {
		return nil, errors.New("too many recipients")
	}

	now := m.now()
	header := gomail.Header{}
	header.SetDate(now)
	fromName := strings.TrimSpace(request.FromName)
	if fromName == "" {
		fromName = account.DisplayName
	}
	from := &mail.Address{Name: fromName, Address: account.Email}
	header.SetAddressList("From", []*mail.Address{from})
	if len(to) > 0 {
		header.SetAddressList("To", to)
	}
	if len(cc) > 0 {
		header.SetAddressList("Cc", cc)
	}
	if forDraft && len(bcc) > 0 {
		header.SetAddressList("Bcc", bcc)
	}
	replyTo := strings.TrimSpace(request.ReplyTo)
	if replyTo == "" {
		replyTo = account.ReplyTo
	}
	if replyTo != "" {
		if parsed, err := mail.ParseAddress(replyTo); err == nil {
			header.SetAddressList("Reply-To", []*mail.Address{parsed})
		}
	}
	header.SetSubject(strings.TrimSpace(request.Subject))

	hostname := domainOf(account.Email)
	if hostname == "" {
		hostname = m.options.Hostname
	}
	if hostname == "" {
		hostname = "arozos.local"
	}
	if err := header.GenerateMessageIDWithHostname(hostname); err != nil {
		return nil, err
	}
	messageID, _ := header.MessageID()

	if id := strings.Trim(strings.TrimSpace(request.InReplyTo), "<>"); id != "" {
		header.SetMsgIDList("In-Reply-To", []string{id})
		references := []string{}
		for _, ref := range request.References {
			if ref = strings.Trim(strings.TrimSpace(ref), "<>"); ref != "" {
				references = append(references, ref)
			}
		}
		//Keep the chain bounded but always end with the message replied to
		if len(references) > 20 {
			references = append(references[:1], references[len(references)-19:]...)
		}
		if len(references) == 0 || references[len(references)-1] != id {
			references = append(references, id)
		}
		header.SetMsgIDList("References", references)
	}

	switch strings.ToLower(request.Priority) {
	case "high":
		header.Set("X-Priority", "1 (Highest)")
		header.Set("Importance", "High")
	case "low":
		header.Set("X-Priority", "5 (Lowest)")
		header.Set("Importance", "Low")
	}
	if request.ReadReceipt {
		header.SetAddressList("Disposition-Notification-To", []*mail.Address{from})
	}
	header.Set("User-Agent", "ArozOS Mail")
	header.Set("MIME-Version", "1.0")

	attachments, err := m.collectAttachments(ctx, p, request)
	if err != nil {
		return nil, err
	}

	var buffer bytes.Buffer
	if err := writeMessageBody(&buffer, header, request, attachments); err != nil {
		return nil, err
	}

	recipients := []string{}
	for _, list := range [][]*mail.Address{to, cc, bcc} {
		for _, address := range list {
			recipients = append(recipients, address.Address)
		}
	}
	built := &builtMessage{
		raw:        buffer.Bytes(),
		messageID:  messageID,
		from:       account.Email,
		recipients: recipients,
		date:       now,
	}
	if !forDraft && len(bcc) > 0 {
		bccHeader := gomail.Header{}
		bccHeader.SetAddressList("Bcc", bcc)
		var line bytes.Buffer
		for fields := bccHeader.Fields(); fields.Next(); {
			raw, err := fields.Raw()
			if err == nil {
				line.Write(raw)
			}
		}
		built.bccHeader = line.String()
	}
	return built, nil
}

type attachmentPayload struct {
	name        string
	contentType string
	open        func() (io.ReadCloser, error)
}

// collectAttachments gathers user files and forwarded server parts and
// enforces the administrator's size budget.
func (m *Manager) collectAttachments(ctx context.Context, p Principal, request *ComposeRequest) ([]attachmentPayload, error) {
	limit := m.maxAttachmentBytes()
	var total int64
	payloads := []attachmentPayload{}

	for _, attachment := range request.Attachments {
		attachment := attachment
		total += attachment.Size
		if attachment.Data != nil && attachment.Size == 0 {
			total += int64(len(attachment.Data))
		}
		contentType := attachment.ContentType
		if contentType == "" {
			contentType = contentTypeFor(attachment.Name)
		}
		open := attachment.Open
		if open == nil {
			data := attachment.Data
			open = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }
		}
		payloads = append(payloads, attachmentPayload{name: sanitizeFilename(attachment.Name), contentType: contentType, open: open})
	}

	for _, forwarded := range request.Forwarded {
		accountID := forwarded.AccountID
		if accountID == "" {
			accountID = request.AccountID
		}
		if forwarded.PartID == "" {
			//"Forward as attachment": the whole original message
			raw, err := m.GetRaw(ctx, p, accountID, forwarded.Folder, forwarded.UID)
			if err != nil {
				return nil, fmt.Errorf("could not attach the original message: %w", err)
			}
			total += int64(len(raw.Data))
			data := raw.Data
			payloads = append(payloads, attachmentPayload{
				name:        raw.Filename,
				contentType: "message/rfc822",
				open:        func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil },
			})
			continue
		}
		part, err := m.GetPart(ctx, p, accountID, forwarded.Folder, forwarded.UID, forwarded.PartID)
		if err != nil {
			return nil, fmt.Errorf("could not include an attachment of the original message: %w", err)
		}
		total += int64(len(part.Data))
		data := part.Data
		payloads = append(payloads, attachmentPayload{
			name:        part.Filename,
			contentType: part.ContentType,
			open:        func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil },
		})
	}

	if limit > 0 && total > limit {
		return nil, fmt.Errorf("attachments total %s, the limit is %s", humanSize(total), humanSize(limit))
	}
	return payloads, nil
}

// writeMessageBody writes the MIME tree described at the top of this file.
func writeMessageBody(w io.Writer, header gomail.Header, request *ComposeRequest, attachments []attachmentPayload) error {
	htmlBody := request.HTML
	textBody := request.Text
	if request.PlainOnly {
		if textBody == "" {
			textBody = htmlToText(htmlBody, true)
		}
		htmlBody = ""
	} else if textBody == "" && htmlBody != "" {
		textBody = htmlToText(htmlBody, true)
	}

	//Pasted images arrive as data: URIs; mail clients need them as parts
	type inlineImage struct {
		cid         string
		contentType string
		data        []byte
	}
	inlineImages := []inlineImage{}
	if htmlBody != "" {
		counter := 0
		htmlBody = dataImagePattern.ReplaceAllStringFunc(htmlBody, func(match string) string {
			groups := dataImagePattern.FindStringSubmatch(match)
			data, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(groups[3]), ""))
			if err != nil {
				return match
			}
			counter++
			cid := fmt.Sprintf("img%d.%s@arozos", counter, randomID(6))
			inlineImages = append(inlineImages, inlineImage{cid: cid, contentType: strings.ToLower(groups[2]), data: data})
			return groups[1] + "cid:" + cid + groups[4]
		})
		htmlBody = wrapHTMLDocument(htmlBody)
	}

	top := header.Header
	writeText := func(create func(gomessage.Header) (*gomessage.Writer, error), contentType string, body string) error {
		partHeader := gomessage.Header{}
		partHeader.SetContentType(contentType, map[string]string{"charset": "utf-8"})
		partHeader.Set("Content-Transfer-Encoding", "quoted-printable")
		part, err := create(partHeader)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(part, normaliseNewlines(body)); err != nil {
			return err
		}
		return part.Close()
	}

	writeHTML := func(create func(gomessage.Header) (*gomessage.Writer, error)) error {
		if len(inlineImages) == 0 {
			return writeText(create, "text/html", htmlBody)
		}
		relatedHeader := gomessage.Header{}
		relatedHeader.SetContentType("multipart/related", map[string]string{"type": "text/html"})
		related, err := create(relatedHeader)
		if err != nil {
			return err
		}
		if err := writeText(related.CreatePart, "text/html", htmlBody); err != nil {
			return err
		}
		for index, image := range inlineImages {
			imageHeader := gomessage.Header{}
			ext := ".png"
			if extensions, _ := mime.ExtensionsByType(image.contentType); len(extensions) > 0 {
				ext = extensions[0]
			}
			name := fmt.Sprintf("image%d%s", index+1, ext)
			imageHeader.SetContentType(image.contentType, map[string]string{"name": name})
			imageHeader.SetContentDisposition("inline", map[string]string{"filename": name})
			imageHeader.Set("Content-Id", "<"+image.cid+">")
			imageHeader.Set("Content-Transfer-Encoding", "base64")
			part, err := related.CreatePart(imageHeader)
			if err != nil {
				return err
			}
			if _, err := part.Write(image.data); err != nil {
				return err
			}
			if err := part.Close(); err != nil {
				return err
			}
		}
		return related.Close()
	}

	writeContent := func(create func(gomessage.Header) (*gomessage.Writer, error)) error {
		if htmlBody == "" {
			return writeText(create, "text/plain", textBody)
		}
		alternativeHeader := gomessage.Header{}
		alternativeHeader.SetContentType("multipart/alternative", nil)
		alternative, err := create(alternativeHeader)
		if err != nil {
			return err
		}
		if err := writeText(alternative.CreatePart, "text/plain", textBody); err != nil {
			return err
		}
		if err := writeHTML(alternative.CreatePart); err != nil {
			return err
		}
		return alternative.Close()
	}

	//The first part created at the top level carries the message header
	topLevel := func(partHeader gomessage.Header) (*gomessage.Writer, error) {
		merged := top.Copy()
		for fields := partHeader.Fields(); fields.Next(); {
			merged.Set(fields.Key(), fields.Value())
		}
		return gomessage.CreateWriter(w, merged)
	}

	if len(attachments) == 0 {
		return writeContent(topLevel)
	}

	mixedHeader := gomessage.Header{}
	mixedHeader.SetContentType("multipart/mixed", nil)
	mixed, err := topLevel(mixedHeader)
	if err != nil {
		return err
	}
	if err := writeContent(mixed.CreatePart); err != nil {
		return err
	}
	for _, attachment := range attachments {
		attachmentHeader := gomessage.Header{}
		attachmentHeader.SetContentType(attachment.contentType, map[string]string{"name": attachment.name})
		attachmentHeader.SetContentDisposition("attachment", map[string]string{"filename": attachment.name})
		if attachment.contentType == "message/rfc822" {
			//RFC 2046 forbids base64 for message/rfc822; the original already
			//crossed SMTP, so its lines are within limits
			attachmentHeader.Set("Content-Transfer-Encoding", "8bit")
		} else {
			attachmentHeader.Set("Content-Transfer-Encoding", "base64")
		}
		part, err := mixed.CreatePart(attachmentHeader)
		if err != nil {
			return err
		}
		reader, err := attachment.open()
		if err != nil {
			return fmt.Errorf("cannot read attachment %s: %w", attachment.name, err)
		}
		_, copyErr := io.Copy(part, reader)
		reader.Close()
		if copyErr != nil {
			return copyErr
		}
		if err := part.Close(); err != nil {
			return err
		}
	}
	return mixed.Close()
}

// wrapHTMLDocument gives editor HTML a complete document with a UTF-8 hint.
func wrapHTMLDocument(body string) string {
	lower := strings.ToLower(body)
	if strings.Contains(lower, "<html") {
		return body
	}
	return "<!DOCTYPE html>\r\n<html><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\"></head><body>" +
		body + "</body></html>"
}

func normaliseNewlines(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.ReplaceAll(text, "\n", "\r\n")
}

// contentTypeFor guesses a media type from a file name.
func contentTypeFor(name string) string {
	if byExt := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); byExt != "" {
		//Drop the charset Go appends for text types; attachments are bytes
		if semicolon := strings.Index(byExt, ";"); semicolon > 0 {
			return strings.TrimSpace(byExt[:semicolon])
		}
		return byExt
	}
	return "application/octet-stream"
}

func humanSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}
