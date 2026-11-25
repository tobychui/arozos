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

	"imuslab.com/arozos/mod/info/logger"
)

const maxEMLSize = 100 * 1024 * 1024

func parseEMLTree(raw []byte) (out0 *mimePart, out1 gomail.Header, out2 error) {
	defer logger.Out3(logger.In1("email", "parseEMLTree", "raw", raw), &out0, &out1, &out2)
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
func (m *Manager) ParseEML(p Principal, raw []byte, allowRemote bool) (out0 *Message, out1 error) {
	defer logger.Out2(logger.In4("email", "Manager.ParseEML", "m", m, "&p", &p, "raw", raw, "allowRemote", allowRemote), &out0, &out1)
	tree, header, err := parseEMLTree(raw)
	if err != nil {
		logger.DebugErr("email", err)
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
func EMLPart(raw []byte, partID string) (out0 *PartData, out1 error) {
	defer logger.Out2(logger.In2("email", "EMLPart", "raw", raw, "partID", partID), &out0, &out1)
	tree, _, err := parseEMLTree(raw)
	if err != nil {
		logger.DebugErr("email", err)
		return nil, err
	}
	part := tree.find(partID)
	if part == nil {
		return nil, errors.New("attachment not found")
	}
	info := attachmentInfo([]*mimePart{part})[0]
	return &PartData{Filename: info.Filename, ContentType: part.mediaType(), Data: part.body}, nil
}
