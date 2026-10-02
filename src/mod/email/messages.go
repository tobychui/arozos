package email

/*
	messages.go

	Listing and reading messages.

	Listing pages through a mailbox by sequence number when no filter applies
	(newest arrivals first, one FETCH per page) and through SEARCH / SORT
	results otherwise. Bodies are never downloaded for the list: the preview
	line comes from a ranged fetch of the first text part.

	Reading fetches the structure first and then only the parts the reading
	pane shows (text, HTML and inline images), so a message with a 20 MB
	attachment opens as fast as one without. Attachments are fetched on demand
	by their part number.
*/

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"net/mail"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	gomessage "github.com/emersion/go-message"
	gomail "github.com/emersion/go-message/mail"
	"github.com/emersion/go-message/textproto"
)

const (
	maxPageSize        = 200
	maxLocalSortWindow = 3000
	previewBytes       = 3072
	maxInlineImage     = 6 * 1024 * 1024
	maxInlineTotal     = 24 * 1024 * 1024
	maxDisplayPart     = 8 * 1024 * 1024
	maxRawMessage      = 150 * 1024 * 1024
)

// ListQuery selects a page of a mailbox.
type ListQuery struct {
	Folder   string `json:"folder"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
	Sort     string `json:"sort"`     //date | date_asc | from | subject | size
	Filter   string `json:"filter"`   //all | unread | flagged | attachments | unanswered
	Search   string `json:"search"`   //Free text
	SearchIn string `json:"searchIn"` //all | from | to | subject | body
	Previews bool   `json:"previews"`
}

func (q *ListQuery) normalise() {
	if q.Folder == "" {
		q.Folder = "INBOX"
	}
	if q.Page < 0 {
		q.Page = 0
	}
	if q.PageSize <= 0 {
		q.PageSize = 50
	}
	if q.PageSize > maxPageSize {
		q.PageSize = maxPageSize
	}
	if !oneOf(q.Sort, "date", "date_asc", "from", "subject", "size") {
		q.Sort = "date"
	}
	if !oneOf(q.Filter, "all", "unread", "flagged", "attachments", "unanswered") {
		q.Filter = "all"
	}
	if !oneOf(q.SearchIn, "all", "from", "to", "subject", "body") {
		q.SearchIn = "all"
	}
	q.Search = strings.TrimSpace(q.Search)
}

// criteria builds the SEARCH criteria of a query, nil when everything matches.
func (q *ListQuery) criteria() *imap.SearchCriteria {
	criteria := &imap.SearchCriteria{}
	used := false
	switch q.Filter {
	case "unread":
		criteria.NotFlag = append(criteria.NotFlag, imap.FlagSeen)
		used = true
	case "flagged":
		criteria.Flag = append(criteria.Flag, imap.FlagFlagged)
		used = true
	case "unanswered":
		criteria.NotFlag = append(criteria.NotFlag, imap.FlagAnswered)
		used = true
	case "attachments":
		//IMAP cannot search for attachments; mixed multipart is the standard
		//container for them and what other clients approximate with too
		criteria.Header = append(criteria.Header, imap.SearchCriteriaHeaderField{Key: "Content-Type", Value: "multipart/mixed"})
		used = true
	}
	if q.Search != "" {
		for _, word := range splitSearchTerms(q.Search) {
			switch q.SearchIn {
			case "from":
				criteria.Header = append(criteria.Header, imap.SearchCriteriaHeaderField{Key: "From", Value: word})
			case "to":
				criteria.Or = append(criteria.Or, [2]imap.SearchCriteria{
					{Header: []imap.SearchCriteriaHeaderField{{Key: "To", Value: word}}},
					{Header: []imap.SearchCriteriaHeaderField{{Key: "Cc", Value: word}}},
				})
			case "subject":
				criteria.Header = append(criteria.Header, imap.SearchCriteriaHeaderField{Key: "Subject", Value: word})
			case "body":
				criteria.Body = append(criteria.Body, word)
			default:
				criteria.Text = append(criteria.Text, word)
			}
		}
		used = true
	}
	if !used {
		return nil
	}
	return criteria
}

var quotedTermPattern = regexp.MustCompile(`"([^"]+)"|(\S+)`)

// splitSearchTerms honours "quoted phrases" and drops very short noise.
func splitSearchTerms(search string) []string {
	terms := []string{}
	for _, match := range quotedTermPattern.FindAllStringSubmatch(search, 8) {
		term := match[1]
		if term == "" {
			term = match[2]
		}
		term = strings.TrimSpace(term)
		if term != "" {
			terms = append(terms, term)
		}
	}
	return terms
}

var listFetchOptions = &imap.FetchOptions{
	UID:           true,
	Flags:         true,
	Envelope:      true,
	InternalDate:  true,
	RFC822Size:    true,
	BodyStructure: &imap.FetchItemBodyStructure{Extended: true},
	BodySection: []*imap.FetchItemBodySection{{
		Specifier:    imap.PartSpecifierHeader,
		HeaderFields: []string{"X-Priority", "Importance", "Priority"},
		Peek:         true,
	}},
}

// ListMessages returns a page of a mailbox.
func (m *Manager) ListMessages(ctx context.Context, p Principal, accountID string, query ListQuery) (*MessageList, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	query.normalise()

	var result *MessageList
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		var err error
		result, err = m.listMessages(c, p, account, query)
		return err
	})
	if err != nil {
		return nil, err
	}
	m.clearAuthError(p, account)
	m.applyLocalState(p, result.Messages)
	return result, nil
}

func selectFolder(c *imapclient.Client, folder string) (*imap.SelectData, error) {
	data, err := c.Select(folder, nil).Wait()
	if err != nil {
		var statusErr *imap.Error
		if errors.As(err, &statusErr) && (statusErr.Code == imap.ResponseCodeNonExistent ||
			strings.Contains(strings.ToLower(statusErr.Text), "doesn't exist") ||
			strings.Contains(strings.ToLower(statusErr.Text), "does not exist") ||
			strings.Contains(strings.ToLower(statusErr.Text), "unknown mailbox")) {
			return nil, ErrFolderNotFound
		}
		return nil, err
	}
	return data, nil
}

func (m *Manager) listMessages(c *imapclient.Client, p Principal, account *Account, query ListQuery) (*MessageList, error) {
	selected, err := selectFolder(c, query.Folder)
	if err != nil {
		return nil, err
	}
	result := &MessageList{Page: query.Page, PageSize: query.PageSize, Messages: []MessageSummary{}}
	criteria := query.criteria()
	total := selected.NumMessages

	var buffers []*imapclient.FetchMessageBuffer
	order := map[imap.UID]int{}

	if criteria == nil && (query.Sort == "date" || query.Sort == "date_asc") {
		//Fast path: sequence numbers follow arrival order
		result.Total = int(total)
		var start, stop uint32
		offset := uint32(query.Page * query.PageSize)
		if offset >= total {
			return result, nil
		}
		if query.Sort == "date" {
			stop = total - offset
			if stop > uint32(query.PageSize) {
				start = stop - uint32(query.PageSize) + 1
			} else {
				start = 1
			}
		} else {
			start = offset + 1
			stop = start + uint32(query.PageSize) - 1
			if stop > total {
				stop = total
			}
		}
		var seqSet imap.SeqSet
		seqSet.AddRange(start, stop)
		buffers, err = c.Fetch(seqSet, listFetchOptions).Collect()
		if err != nil {
			return nil, err
		}
		sort.Slice(buffers, func(i, j int) bool {
			if query.Sort == "date" {
				return buffers[i].SeqNum > buffers[j].SeqNum
			}
			return buffers[i].SeqNum < buffers[j].SeqNum
		})
	} else {
		uids, sortUnsupported, err := m.orderedUIDs(c, criteria, query)
		if err != nil {
			return nil, err
		}
		result.SortUnsupported = sortUnsupported
		result.Total = len(uids)
		begin := query.Page * query.PageSize
		if begin >= len(uids) {
			return result, nil
		}
		end := begin + query.PageSize
		if end > len(uids) {
			end = len(uids)
		}
		pageUIDs := uids[begin:end]
		for index, uid := range pageUIDs {
			order[uid] = index
		}
		buffers, err = c.Fetch(imap.UIDSetNum(pageUIDs...), listFetchOptions).Collect()
		if err != nil {
			return nil, err
		}
		sort.Slice(buffers, func(i, j int) bool { return order[buffers[i].UID] < order[buffers[j].UID] })
	}

	for _, buffer := range buffers {
		result.Messages = append(result.Messages, summaryFromBuffer(account.ID, query.Folder, selected.UIDValidity, buffer))
	}
	if query.Previews {
		m.fillPreviews(c, p.Username, account.ID, query.Folder, selected.UIDValidity, buffers, result.Messages)
	}
	return result, nil
}

// orderedUIDs runs SEARCH / SORT for a filtered or re-sorted listing.
func (m *Manager) orderedUIDs(c *imapclient.Client, criteria *imap.SearchCriteria, query ListQuery) ([]imap.UID, bool, error) {
	searchCriteria := criteria
	if searchCriteria == nil {
		searchCriteria = &imap.SearchCriteria{}
	}

	sortKey := map[string]imapclient.SortKey{
		"date": imapclient.SortKeyArrival, "date_asc": imapclient.SortKeyArrival,
		"from": imapclient.SortKeyFrom, "subject": imapclient.SortKeySubject, "size": imapclient.SortKeySize,
	}[query.Sort]
	reverse := query.Sort == "date" || query.Sort == "size"

	if c.Caps().Has(imap.CapSort) {
		sortCommand := c.UIDSort(&imapclient.SortOptions{
			SearchCriteria: searchCriteria,
			SortCriteria:   []imapclient.SortCriterion{{Key: sortKey, Reverse: reverse}},
		})
		if nums, err := sortCommand.Wait(); err == nil {
			uids := make([]imap.UID, len(nums))
			for i, num := range nums {
				uids[i] = imap.UID(num)
			}
			return uids, false, nil
		}
		//Fall through to SEARCH when SORT is advertised but fails
	}

	data, err := c.UIDSearch(searchCriteria, nil).Wait()
	if err != nil {
		return nil, false, err
	}
	uids := data.AllUIDs()
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })

	switch query.Sort {
	case "date":
		reverseUIDs(uids)
		return uids, false, nil
	case "date_asc":
		return uids, false, nil
	}

	//Sorting by sender / subject / size without server SORT means reading the
	//envelope of every match, which is only reasonable for small result sets
	if len(uids) > maxLocalSortWindow {
		reverseUIDs(uids)
		return uids, true, nil
	}
	if len(uids) == 0 {
		return uids, false, nil
	}
	buffers, err := c.Fetch(imap.UIDSetNum(uids...), &imap.FetchOptions{UID: true, Envelope: true, RFC822Size: true}).Collect()
	if err != nil {
		return nil, false, err
	}
	keyOf := func(buffer *imapclient.FetchMessageBuffer) string {
		if buffer.Envelope == nil {
			return ""
		}
		switch query.Sort {
		case "from":
			if len(buffer.Envelope.From) > 0 {
				from := buffer.Envelope.From[0]
				if from.Name != "" {
					return strings.ToLower(from.Name)
				}
				return strings.ToLower(from.Addr())
			}
		case "subject":
			return strings.ToLower(baseSubject(buffer.Envelope.Subject))
		}
		return ""
	}
	sort.SliceStable(buffers, func(i, j int) bool {
		if query.Sort == "size" {
			return buffers[i].RFC822Size > buffers[j].RFC822Size
		}
		return keyOf(buffers[i]) < keyOf(buffers[j])
	})
	sorted := make([]imap.UID, 0, len(buffers))
	for _, buffer := range buffers {
		sorted = append(sorted, buffer.UID)
	}
	return sorted, false, nil
}

func reverseUIDs(uids []imap.UID) {
	for i, j := 0, len(uids)-1; i < j; i, j = i+1, j-1 {
		uids[i], uids[j] = uids[j], uids[i]
	}
}

var subjectPrefixPattern = regexp.MustCompile(`(?i)^\s*((re|fw|fwd|aw|wg|sv|vs|antw|回复|回覆|答复|转发|轉寄)\s*(\[\d+\])?\s*[:：]\s*)+`)

// baseSubject strips reply / forward prefixes for sorting and threading.
func baseSubject(subject string) string {
	return strings.TrimSpace(subjectPrefixPattern.ReplaceAllString(subject, ""))
}

// summaryFromBuffer converts a FETCH response into a list row.
func summaryFromBuffer(accountID string, folder string, uidValidity uint32, buffer *imapclient.FetchMessageBuffer) MessageSummary {
	summary := MessageSummary{
		AccountID:   accountID,
		Folder:      folder,
		UID:         uint32(buffer.UID),
		UIDValidity: uidValidity,
		Size:        buffer.RFC822Size,
		Priority:    3,
		From:        []Address{},
		To:          []Address{},
		Cc:          []Address{},
		Labels:      []string{},
	}
	if !buffer.InternalDate.IsZero() {
		summary.Received = buffer.InternalDate.UnixMilli()
	}
	if envelope := buffer.Envelope; envelope != nil {
		summary.Subject = decodeHeaderWords(envelope.Subject)
		summary.MessageID = envelope.MessageID
		summary.From = convertAddresses(envelope.From)
		summary.To = convertAddresses(envelope.To)
		summary.Cc = convertAddresses(envelope.Cc)
		if !envelope.Date.IsZero() {
			summary.Date = envelope.Date.UnixMilli()
		}
	}
	if summary.Date == 0 {
		summary.Date = summary.Received
	}
	if summary.Received == 0 {
		summary.Received = summary.Date
	}
	applyFlags(&summary, buffer.Flags)
	if buffer.BodyStructure != nil {
		summary.HasAttachments = hasRealAttachments(treeFromBodyStructure(buffer.BodyStructure))
	}
	for _, section := range buffer.BodySection {
		if section.Section != nil && section.Section.Specifier == imap.PartSpecifierHeader {
			summary.Priority = priorityFromHeader(section.Bytes)
		}
	}
	return summary
}

func applyFlags(summary *MessageSummary, flags []imap.Flag) {
	for _, flag := range flags {
		switch strings.ToLower(string(flag)) {
		case strings.ToLower(string(imap.FlagSeen)):
			summary.Seen = true
		case strings.ToLower(string(imap.FlagFlagged)):
			summary.Flagged = true
		case strings.ToLower(string(imap.FlagAnswered)):
			summary.Answered = true
		case strings.ToLower(string(imap.FlagDraft)):
			summary.Draft = true
		case strings.ToLower(string(imap.FlagForwarded)):
			summary.Forwarded = true
		}
	}
}

func convertAddresses(list []imap.Address) []Address {
	results := []Address{}
	for _, address := range list {
		if address.IsGroupStart() || address.IsGroupEnd() {
			continue
		}
		email := address.Addr()
		if email == "" {
			continue
		}
		results = append(results, Address{Name: decodeHeaderWords(address.Name), Email: email})
	}
	return results
}

// priorityFromHeader reads X-Priority / Importance / Priority.
func priorityFromHeader(raw []byte) int {
	header, err := textproto.ReadHeader(bufio.NewReader(bytes.NewReader(append(raw, '\r', '\n'))))
	if err != nil {
		return 3
	}
	return priorityFromFields(header.Get("X-Priority"), header.Get("Importance"), header.Get("Priority"))
}

func priorityFromFields(xPriority string, importance string, priority string) int {
	if value := strings.TrimSpace(xPriority); value != "" {
		if n, err := strconv.Atoi(value[:1]); err == nil && n >= 1 && n <= 5 {
			switch {
			case n <= 2:
				return 1
			case n >= 4:
				return 5
			}
			return 3
		}
	}
	switch strings.ToLower(strings.TrimSpace(importance)) {
	case "high":
		return 1
	case "low":
		return 5
	}
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "urgent":
		return 1
	case "non-urgent":
		return 5
	}
	return 3
}

// fillPreviews fetches the first bytes of each message's main text part.
func (m *Manager) fillPreviews(c *imapclient.Client, owner string, accountID string, folder string, uidValidity uint32,
	buffers []*imapclient.FetchMessageBuffer, summaries []MessageSummary) {

	type wanted struct {
		index int
		part  *mimePart
		html  bool
	}
	groups := map[string][]wanted{}
	for index, buffer := range buffers {
		key := previewKey(owner, accountID, folder, uidValidity, uint32(buffer.UID))
		if cached, ok := m.previews.get(key); ok {
			summaries[index].Preview = cached
			continue
		}
		tree := treeFromBodyStructure(buffer.BodyStructure)
		parts := selectDisplayParts(tree)
		part, isHTML := parts.text, false
		if part == nil {
			part, isHTML = parts.html, true
		}
		if part == nil {
			m.previews.put(key, "")
			continue
		}
		groups[part.Path] = append(groups[part.Path], wanted{index: index, part: part, html: isHTML})
	}

	for path, items := range groups {
		uids := make([]imap.UID, 0, len(items))
		for _, item := range items {
			uids = append(uids, buffers[item.index].UID)
		}
		section := &imap.FetchItemBodySection{Part: partNumbers(path), Peek: true, Partial: &imap.SectionPartial{Offset: 0, Size: previewBytes}}
		fetched, err := c.Fetch(imap.UIDSetNum(uids...), &imap.FetchOptions{UID: true, BodySection: []*imap.FetchItemBodySection{section}}).Collect()
		if err != nil {
			continue
		}
		byUID := map[imap.UID][]byte{}
		for _, buffer := range fetched {
			for _, body := range buffer.BodySection {
				byUID[buffer.UID] = body.Bytes
			}
		}
		for _, item := range items {
			uid := buffers[item.index].UID
			raw, ok := byUID[uid]
			if !ok {
				continue
			}
			text := partText(item.part, raw, true)
			if item.html {
				text = htmlToText(text, false)
			}
			preview := previewText(text, 180)
			summaries[item.index].Preview = preview
			m.previews.put(previewKey(owner, accountID, folder, uidValidity, uint32(uid)), preview)
		}
	}
}

// partNumbers turns "1.2" into []int{1, 2}.
func partNumbers(path string) []int {
	if path == "" {
		return nil
	}
	fields := strings.Split(path, ".")
	numbers := make([]int, 0, len(fields))
	for _, field := range fields {
		n, err := strconv.Atoi(field)
		if err != nil {
			return nil
		}
		numbers = append(numbers, n)
	}
	return numbers
}

// GetOptions controls GetMessage.
type GetOptions struct {
	MarkSeen    bool `json:"markSeen"`
	AllowRemote bool `json:"allowRemote"`
}

// GetMessage loads one message for the reading pane.
func (m *Manager) GetMessage(ctx context.Context, p Principal, accountID string, folder string, uid uint32, options GetOptions) (*Message, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	settings := m.store.getSettings(p.Username)

	var message *Message
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		selected, err := selectFolder(c, folder)
		if err != nil {
			return err
		}
		uidSet := imap.UIDSetNum(imap.UID(uid))
		headerSection := &imap.FetchItemBodySection{Specifier: imap.PartSpecifierHeader, Peek: true}
		buffers, err := c.Fetch(uidSet, &imap.FetchOptions{
			UID: true, Flags: true, Envelope: true, InternalDate: true, RFC822Size: true,
			BodyStructure: &imap.FetchItemBodyStructure{Extended: true},
			BodySection:   []*imap.FetchItemBodySection{headerSection},
		}).Collect()
		if err != nil {
			return err
		}
		if len(buffers) == 0 {
			return ErrMessageNotFound
		}
		buffer := buffers[0]
		summary := summaryFromBuffer(account.ID, folder, selected.UIDValidity, buffer)
		header := parseHeaderBytes(buffer.FindBodySection(headerSection))

		tree := treeFromBodyStructure(buffer.BodyStructure)
		parts := selectDisplayParts(tree)
		bodies := map[string][]byte{}

		needed := []*mimePart{}
		if parts.html != nil && parts.html.Size <= maxDisplayPart {
			needed = append(needed, parts.html)
		}
		if parts.text != nil && parts.text.Size <= maxDisplayPart {
			needed = append(needed, parts.text)
		}
		inlineBudget := int64(maxInlineTotal)
		for _, part := range parts.inline {
			if part.Size <= maxInlineImage && part.Size <= inlineBudget {
				needed = append(needed, part)
				inlineBudget -= part.Size
			}
		}

		if len(needed) > 0 {
			sections := []*imap.FetchItemBodySection{}
			for _, part := range needed {
				sections = append(sections, &imap.FetchItemBodySection{Part: partNumbers(part.Path), Peek: true})
			}
			fetched, err := c.Fetch(uidSet, &imap.FetchOptions{UID: true, BodySection: sections}).Collect()
			if err != nil {
				return err
			}
			if len(fetched) > 0 {
				for i, part := range needed {
					bodies[part.Path] = fetched[0].FindBodySection(sections[i])
				}
			}
		}

		//A broken BODYSTRUCTURE (it happens) leaves nothing to show: parse the
		//whole message locally instead when it is of a sane size
		if parts.html == nil && parts.text == nil && buffer.RFC822Size > 0 && buffer.RFC822Size <= 32*1024*1024 {
			fullSection := &imap.FetchItemBodySection{Peek: true}
			full, err := c.Fetch(uidSet, &imap.FetchOptions{UID: true, BodySection: []*imap.FetchItemBodySection{fullSection}}).Collect()
			if err == nil && len(full) > 0 {
				if entity, perr := gomessage.Read(bytes.NewReader(full[0].FindBodySection(fullSection))); perr == nil || gomessage.IsUnknownCharset(perr) {
					tree = treeFromEntity(entity)
					parts = selectDisplayParts(tree)
					bodies = map[string][]byte{}
				}
			}
		}

		allowRemote := options.AllowRemote || settings.RemoteImages == "always"
		if !allowRemote && len(summary.From) > 0 && settings.IsTrustedSender(summary.From[0].Email) {
			allowRemote = true
		}
		message = buildMessage(summary, header, parts, bodies, allowRemote)

		if options.MarkSeen && !summary.Seen {
			if err := c.Store(uidSet, &imap.StoreFlags{Op: imap.StoreFlagsAdd, Silent: true, Flags: []imap.Flag{imap.FlagSeen}}, nil).Close(); err == nil {
				message.Seen = true
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	m.clearAuthError(p, account)
	summaries := []MessageSummary{message.MessageSummary}
	m.applyLocalState(p, summaries)
	message.Labels = summaries[0].Labels
	return message, nil
}

// parseHeaderBytes parses a raw header block, tolerating junk.
func parseHeaderBytes(raw []byte) gomail.Header {
	if len(raw) == 0 {
		return gomail.Header{}
	}
	header, err := textproto.ReadHeader(bufio.NewReader(bytes.NewReader(raw)))
	if err != nil {
		return gomail.Header{Header: gomessage.Header{Header: header}}
	}
	return gomail.Header{Header: gomessage.Header{Header: header}}
}

// buildMessage assembles the reading-pane message from fetched parts.
func buildMessage(summary MessageSummary, header gomail.Header, parts displayParts, bodies map[string][]byte, allowRemote bool) *Message {
	message := &Message{
		MessageSummary: summary,
		ReplyTo:        headerAddresses(header, "Reply-To"),
		Bcc:            headerAddresses(header, "Bcc"),
		References:     []string{},
		Attachments:    attachmentInfo(parts.attachments),
		Signed:         parts.signed,
		Encrypted:      parts.encrypted,
		Calendar:       parts.calendar,
		RemoteAllowed:  allowRemote,
	}
	if summary.Subject == "" {
		if subject, err := header.Subject(); err == nil {
			message.Subject = subject
		}
	}
	if ids, err := header.MsgIDList("In-Reply-To"); err == nil && len(ids) > 0 {
		message.InReplyTo = ids[0]
	}
	if ids, err := header.MsgIDList("References"); err == nil {
		message.References = ids
	}
	if message.MessageID == "" {
		if id, err := header.MessageID(); err == nil {
			message.MessageID = id
		}
	}
	if len(message.From) == 0 {
		message.From = headerAddresses(header, "From")
	}
	message.ListUnsubscribe = pickUnsubscribe(header.Get("List-Unsubscribe"))
	if receipt := headerAddresses(header, "Disposition-Notification-To"); len(receipt) > 0 {
		message.ReadReceiptTo = receipt[0].Email
	}
	message.Auth = parseAuthResults(header.Values("Authentication-Results"))
	if message.Priority == 3 {
		message.Priority = priorityFromFields(header.Get("X-Priority"), header.Get("Importance"), header.Get("Priority"))
	}

	if parts.text != nil {
		text := partText(parts.text, bodies[parts.text.Path], false)
		if strings.EqualFold(parts.text.Params["format"], "flowed") {
			text = unflowText(text, strings.EqualFold(parts.text.Params["delsp"], "yes"))
		}
		message.Text = text
	}
	if parts.html != nil {
		cid := map[string]string{}
		for _, part := range parts.inline {
			data := part.body
			if data == nil {
				raw, ok := bodies[part.Path]
				if !ok {
					continue
				}
				data = decodeTransfer(raw, part.Encoding, false)
			}
			cid[strings.ToLower(part.ContentID)] = "data:" + part.mediaType() + ";base64," + base64.StdEncoding.EncodeToString(data)
		}
		source := partText(parts.html, bodies[parts.html.Path], false)
		sanitized := sanitizeHTML(source, sanitizeOptions{allowRemote: allowRemote, cid: cid})
		message.HTML = sanitized.html
		message.HasRemoteContent = sanitized.hasRemote
		if message.Text == "" {
			message.Text = htmlToText(source, true)
		}
	}
	if message.Preview == "" {
		message.Preview = previewText(message.Text, 180)
	}
	return message
}

func headerAddresses(header gomail.Header, key string) []Address {
	results := []Address{}
	list, err := header.AddressList(key)
	if err != nil {
		//Fall back to a lenient split for malformed lists
		for _, piece := range strings.Split(header.Get(key), ",") {
			if parsed, perr := mail.ParseAddress(strings.TrimSpace(piece)); perr == nil {
				results = append(results, Address{Name: parsed.Name, Email: parsed.Address})
			}
		}
		return results
	}
	for _, address := range list {
		results = append(results, Address{Name: address.Name, Email: address.Address})
	}
	return results
}

// pickUnsubscribe prefers an https unsubscribe link over mailto.
func pickUnsubscribe(header string) string {
	if header == "" {
		return ""
	}
	var mailto string
	for _, item := range strings.Split(header, ",") {
		item = strings.Trim(strings.TrimSpace(item), "<>")
		lower := strings.ToLower(item)
		if strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://") {
			return item
		}
		if strings.HasPrefix(lower, "mailto:") && mailto == "" {
			mailto = item
		}
	}
	return mailto
}

var authResultPattern = regexp.MustCompile(`(?i)\b(spf|dkim|dmarc)\s*=\s*([a-z]+)`)

// parseAuthResults keeps the verdicts of the first (receiving) server.
func parseAuthResults(values []string) *AuthResults {
	if len(values) == 0 {
		return nil
	}
	results := &AuthResults{}
	for _, match := range authResultPattern.FindAllStringSubmatch(values[0], -1) {
		verdict := strings.ToLower(match[2])
		switch strings.ToLower(match[1]) {
		case "spf":
			if results.SPF == "" {
				results.SPF = verdict
			}
		case "dkim":
			if results.DKIM == "" || verdict == "pass" {
				results.DKIM = verdict
			}
		case "dmarc":
			if results.DMARC == "" {
				results.DMARC = verdict
			}
		}
	}
	if results.SPF == "" && results.DKIM == "" && results.DMARC == "" {
		return nil
	}
	return results
}

// unflowText reverses format=flowed soft line breaks (RFC 3676).
func unflowText(text string, delSpace bool) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var builder strings.Builder
	for i, line := range lines {
		if line == "-- " {
			builder.WriteString(line + "\n")
			continue
		}
		if strings.HasPrefix(line, " ") {
			line = line[1:] //Space stuffing
		}
		if strings.HasSuffix(line, " ") && i < len(lines)-1 {
			if delSpace {
				line = strings.TrimSuffix(line, " ")
			}
			builder.WriteString(line)
			continue
		}
		builder.WriteString(line)
		if i < len(lines)-1 {
			builder.WriteString("\n")
		}
	}
	return builder.String()
}

// GetRaw downloads the full RFC 822 source of a message.
func (m *Manager) GetRaw(ctx context.Context, p Principal, accountID string, folder string, uid uint32) (*RawMessage, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	var raw *RawMessage
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		section := &imap.FetchItemBodySection{Peek: true}
		buffers, err := c.Fetch(imap.UIDSetNum(imap.UID(uid)), &imap.FetchOptions{
			UID: true, Envelope: true, InternalDate: true, RFC822Size: true, BodySection: []*imap.FetchItemBodySection{section},
		}).Collect()
		if err != nil {
			return err
		}
		if len(buffers) == 0 {
			return ErrMessageNotFound
		}
		if buffers[0].RFC822Size > maxRawMessage {
			return ErrTooLarge
		}
		subject := ""
		if buffers[0].Envelope != nil {
			subject = decodeHeaderWords(buffers[0].Envelope.Subject)
		}
		raw = &RawMessage{Filename: emlFilename(subject, buffers[0].InternalDate), Data: buffers[0].FindBodySection(section)}
		return nil
	})
	return raw, err
}

// emlFilename names a saved message after its subject.
func emlFilename(subject string, date time.Time) string {
	name := strings.TrimSpace(subject)
	if name == "" {
		name = "Message"
	}
	if len([]rune(name)) > 80 {
		name = string([]rune(name)[:80])
	}
	if !date.IsZero() {
		name = date.Format("2006-01-02") + " " + name
	}
	return sanitizeFilename(name) + ".eml"
}

// GetPart downloads one attachment by its part number.
func (m *Manager) GetPart(ctx context.Context, p Principal, accountID string, folder string, uid uint32, partID string) (*PartData, error) {
	account, err := m.account(p, accountID)
	if err != nil {
		return nil, err
	}
	numbers := partNumbers(partID)
	if numbers == nil {
		return nil, errors.New("invalid attachment id")
	}
	var data *PartData
	err = m.withIMAP(ctx, p, account, func(c *imapclient.Client) error {
		if _, err := selectFolder(c, folder); err != nil {
			return err
		}
		uidSet := imap.UIDSetNum(imap.UID(uid))
		structure, err := c.Fetch(uidSet, &imap.FetchOptions{UID: true, BodyStructure: &imap.FetchItemBodyStructure{Extended: true}}).Collect()
		if err != nil {
			return err
		}
		if len(structure) == 0 {
			return ErrMessageNotFound
		}
		tree := treeFromBodyStructure(structure[0].BodyStructure)
		part := tree.find(partID)
		if part == nil {
			return errors.New("attachment not found")
		}
		section := &imap.FetchItemBodySection{Part: numbers, Peek: true}
		buffers, err := c.Fetch(uidSet, &imap.FetchOptions{UID: true, BodySection: []*imap.FetchItemBodySection{section}}).Collect()
		if err != nil {
			return err
		}
		if len(buffers) == 0 {
			return ErrMessageNotFound
		}
		info := attachmentInfo([]*mimePart{part})[0]
		data = &PartData{
			Filename:    info.Filename,
			ContentType: part.mediaType(),
			Data:        decodeTransfer(buffers[0].FindBodySection(section), part.Encoding, false),
		}
		return nil
	})
	return data, err
}
