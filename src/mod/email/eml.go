package email

/*
	eml.go

	Reading .eml files stored in the ArozOS file system: the Mail app opens
	them like any other message (File Manager double-click), can extract their
	attachments and can import them into a mailbox.
*/

import (
	"bytes"
	"errors"

	gomessage "github.com/emersion/go-message"
	gomail "github.com/emersion/go-message/mail"
)

const maxEMLSize = 100 * 1024 * 1024

func parseEMLTree(raw []byte) (*mimePart, gomail.Header, error) {
	if len(raw) == 0 {
		return nil, gomail.Header{}, errors.New("the file is empty")
	}
	if len(raw) > maxEMLSize {
		return nil, gomail.Header{}, ErrTooLarge
	}
	entity, err := gomessage.Read(bytes.NewReader(raw))
	if err != nil && !gomessage.IsUnknownCharset(err) && !gomessage.IsUnknownEncoding(err) {
		return nil, gomail.Header{}, errors.New("the file is not a valid email message")
	}
	header := gomail.Header{Header: entity.Header}
	return treeFromEntity(entity), header, nil
}

// ParseEML renders an .eml file for the reading pane.
func (m *Manager) ParseEML(p Principal, raw []byte, allowRemote bool) (*Message, error) {
	tree, header, err := parseEMLTree(raw)
	if err != nil {
		return nil, err
	}
	summary := MessageSummary{
		From:     headerAddresses(header, "From"),
		To:       headerAddresses(header, "To"),
		Cc:       headerAddresses(header, "Cc"),
		Priority: 3,
		Labels:   []string{},
		Seen:     true,
		Size:     int64(len(raw)),
	}
	if subject, err := header.Subject(); err == nil {
		summary.Subject = subject
	}
	if date, err := header.Date(); err == nil {
		summary.Date = date.UnixMilli()
		summary.Received = summary.Date
	}
	if id, err := header.MessageID(); err == nil {
		summary.MessageID = id
	}

	settings := m.store.getSettings(p.Username)
	if !allowRemote {
		allowRemote = settings.RemoteImages == "always" ||
			(len(summary.From) > 0 && settings.IsTrustedSender(summary.From[0].Email))
	}

	parts := selectDisplayParts(tree)
	summary.HasAttachments = len(parts.attachments) > 0
	return buildMessage(summary, header, parts, map[string][]byte{}, allowRemote), nil
}

// EMLPart extracts one attachment of an .eml file.
func EMLPart(raw []byte, partID string) (*PartData, error) {
	tree, _, err := parseEMLTree(raw)
	if err != nil {
		return nil, err
	}
	part := tree.find(partID)
	if part == nil {
		return nil, errors.New("attachment not found")
	}
	info := attachmentInfo([]*mimePart{part})[0]
	return &PartData{Filename: info.Filename, ContentType: part.mediaType(), Data: part.body}, nil
}
