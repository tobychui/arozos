package email

/*
	mimeparts.go

	A single MIME part tree used for both server messages (built from the IMAP
	BODYSTRUCTURE) and local .eml files (built from go-message entities).

	Part paths always follow IMAP section numbering ("1", "1.2", …), so an
	attachment id handed to the browser can be fetched straight from the server
	with BODY.PEEK[<id>] without downloading the whole message.
*/

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/quotedprintable"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/emersion/go-imap/v2"
	gomessage "github.com/emersion/go-message"
	"github.com/emersion/go-message/charset"
)

type mimePart struct {
	Path        string
	Type        string //lower case, e.g. "text"
	Subtype     string //lower case, e.g. "html"
	Params      map[string]string
	Encoding    string
	Disposition string
	DispParams  map[string]string
	ContentID   string
	Size        int64
	Children    []*mimePart
	Parent      *mimePart

	body []byte //Decoded content, local entities only
}

func (p *mimePart) mediaType() string {
	return p.Type + "/" + p.Subtype
}

func (p *mimePart) isMultipart() bool {
	return p.Type == "multipart"
}

// filename returns the decoded file name of a part, if any.
func (p *mimePart) filename() string {
	name := rfc2231Param(p.DispParams, "filename")
	if name == "" {
		name = rfc2231Param(p.Params, "name")
	}
	return decodeHeaderWords(strings.TrimSpace(name))
}

// insideRelated reports whether the part belongs to a multipart/related
// group (inline resources of an HTML body).
func (p *mimePart) insideRelated() bool {
	for parent := p.Parent; parent != nil; parent = parent.Parent {
		if parent.Type == "multipart" && parent.Subtype == "related" {
			return true
		}
	}
	return false
}

// walk visits every part depth first.
func (p *mimePart) walk(visit func(*mimePart)) {
	visit(p)
	for _, child := range p.Children {
		child.walk(visit)
	}
}

// find returns the part with the given path.
func (p *mimePart) find(path string) *mimePart {
	var found *mimePart
	p.walk(func(part *mimePart) {
		if found == nil && part.Path == path && !part.isMultipart() {
			found = part
		}
	})
	return found
}

func lowerParams(params map[string]string) map[string]string {
	result := map[string]string{}
	for key, value := range params {
		result[strings.ToLower(key)] = value
	}
	return result
}

func joinPath(path []int) string {
	parts := make([]string, len(path))
	for i, n := range path {
		parts[i] = strconv.Itoa(n)
	}
	return strings.Join(parts, ".")
}

// treeFromBodyStructure converts an IMAP BODYSTRUCTURE.
func treeFromBodyStructure(bs imap.BodyStructure) *mimePart {
	if bs == nil {
		return nil
	}
	nodes := map[string]*mimePart{}
	var root *mimePart

	bs.Walk(func(path []int, part imap.BodyStructure) bool {
		node := &mimePart{Path: joinPath(path), Params: map[string]string{}, DispParams: map[string]string{}}
		switch typed := part.(type) {
		case *imap.BodyStructureSinglePart:
			node.Type = strings.ToLower(typed.Type)
			node.Subtype = strings.ToLower(typed.Subtype)
			node.Params = lowerParams(typed.Params)
			node.Encoding = strings.ToLower(typed.Encoding)
			node.ContentID = strings.Trim(strings.TrimSpace(typed.ID), "<>")
			node.Size = int64(typed.Size)
			if disposition := typed.Disposition(); disposition != nil {
				node.Disposition = strings.ToLower(disposition.Value)
				node.DispParams = lowerParams(disposition.Params)
			}
		case *imap.BodyStructureMultiPart:
			node.Type = "multipart"
			node.Subtype = strings.ToLower(typed.Subtype)
			if typed.Extended != nil {
				node.Params = lowerParams(typed.Extended.Params)
			}
		}

		if root == nil {
			root = node
		} else {
			parentPath := ""
			if len(path) > 1 {
				parentPath = joinPath(path[:len(path)-1])
			}
			if parent, ok := nodes[parentPath]; ok {
				node.Parent = parent
				parent.Children = append(parent.Children, node)
			}
		}
		if node.isMultipart() {
			nodes[node.Path] = node
		}
		return true
	})
	return root
}

// treeFromEntity converts a parsed local message. Bodies are decoded into
// memory, which is fine for .eml files a user opens one at a time.
func treeFromEntity(entity *gomessage.Entity) *mimePart {
	var build func(e *gomessage.Entity, path []int, parent *mimePart) *mimePart
	build = func(e *gomessage.Entity, path []int, parent *mimePart) *mimePart {
		mediaType, params, _ := e.Header.ContentType()
		if mediaType == "" {
			mediaType = "text/plain"
		}
		typeParts := strings.SplitN(strings.ToLower(mediaType), "/", 2)
		node := &mimePart{
			Type:     typeParts[0],
			Params:   lowerParams(params),
			Encoding: strings.ToLower(e.Header.Get("Content-Transfer-Encoding")),
			Parent:   parent,
		}
		if len(typeParts) > 1 {
			node.Subtype = typeParts[1]
		}
		disposition, dispParams, _ := e.Header.ContentDisposition()
		node.Disposition = strings.ToLower(disposition)
		node.DispParams = lowerParams(dispParams)
		node.ContentID = strings.Trim(strings.TrimSpace(e.Header.Get("Content-Id")), "<>")

		if reader := e.MultipartReader(); reader != nil {
			node.Type = "multipart"
			node.Path = joinPath(path)
			index := 0
			for {
				child, err := reader.NextPart()
				if err != nil {
					break
				}
				index++
				childPath := append(append([]int{}, path...), index)
				node.Children = append(node.Children, build(child, childPath, node))
			}
			return node
		}

		if len(path) == 0 {
			node.Path = "1"
		} else {
			node.Path = joinPath(path)
		}
		data, _ := io.ReadAll(io.LimitReader(e.Body, 256*1024*1024))
		node.body = data
		node.Size = int64(len(data))
		return node
	}
	return build(entity, []int{}, nil)
}

// displayParts picks what the reading pane shows from a part tree.
type displayParts struct {
	html        *mimePart
	text        *mimePart
	inline      []*mimePart //Resources referenced by Content-ID
	attachments []*mimePart
	signed      bool
	encrypted   bool
	calendar    bool
}

func selectDisplayParts(root *mimePart) displayParts {
	result := displayParts{}
	if root == nil {
		return result
	}

	var visit func(part *mimePart)
	visit = func(part *mimePart) {
		if part.isMultipart() {
			switch part.Subtype {
			case "alternative":
				//Alternatives are ordered plainest first; take the richest one
				//we can render, ranking HTML (or a group holding it) above text.
				//Ranking instead of "last wins" survives mailers that order the
				//parts wrongly and Apple's text/watch-html interlude.
				var best *mimePart
				bestRank := 0
				for _, child := range part.Children {
					rank := 0
					switch {
					case child.isMultipart() || child.mediaType() == "text/html":
						rank = 2
					case child.mediaType() == "text/plain":
						rank = 1
					}
					if rank > 0 && rank >= bestRank {
						best = child
						bestRank = rank
					}
				}
				for _, child := range part.Children {
					if child == best {
						visit(child)
					} else if child.mediaType() == "text/plain" && result.text == nil {
						result.text = child
					} else if child.mediaType() == "text/calendar" {
						result.calendar = true
						result.attachments = append(result.attachments, child)
					}
				}
				return
			case "signed":
				result.signed = true
				if len(part.Children) > 0 {
					visit(part.Children[0])
				}
				return
			case "encrypted":
				result.encrypted = true
				return
			}
			for _, child := range part.Children {
				visit(child)
			}
			return
		}

		mediaType := part.mediaType()
		isAttachment := part.Disposition == "attachment"
		switch {
		case mediaType == "application/pkcs7-signature" || mediaType == "application/x-pkcs7-signature" || mediaType == "application/pgp-signature":
			result.signed = true
			return
		case mediaType == "application/pkcs7-mime" || mediaType == "application/x-pkcs7-mime":
			if smimeType := part.Params["smime-type"]; smimeType == "signed-data" {
				result.signed = true
			} else {
				result.encrypted = true
			}
			result.attachments = append(result.attachments, part)
			return
		case mediaType == "text/html" && !isAttachment:
			if result.html == nil {
				result.html = part
				return
			}
		case mediaType == "text/plain" && !isAttachment && part.filename() == "":
			if result.text == nil {
				result.text = part
				return
			}
		case mediaType == "text/calendar":
			result.calendar = true
		}

		if part.ContentID != "" && part.Type == "image" && !isAttachment {
			result.inline = append(result.inline, part)
			//Signature logos inside multipart/related are not attachments
			if part.insideRelated() {
				return
			}
		}
		result.attachments = append(result.attachments, part)
	}
	visit(root)
	return result
}

// hasRealAttachments decides the paper clip in the message list.
func hasRealAttachments(root *mimePart) bool {
	parts := selectDisplayParts(root)
	for _, part := range parts.attachments {
		if part.Type == "image" && part.ContentID != "" && part.insideRelated() {
			continue
		}
		return true
	}
	return false
}

// attachmentInfo converts parts to the browser structure.
func attachmentInfo(parts []*mimePart) []Attachment {
	results := []Attachment{}
	used := map[string]int{}
	for _, part := range parts {
		name := part.filename()
		if name == "" {
			name = defaultFilename(part)
		}
		//Two attachments with the same name would overwrite each other when saved
		key := strings.ToLower(name)
		if count := used[key]; count > 0 {
			ext := ""
			if dot := strings.LastIndex(name, "."); dot > 0 {
				ext = name[dot:]
				name = name[:dot]
			}
			name = name + " (" + strconv.Itoa(count+1) + ")" + ext
		}
		used[key]++
		results = append(results, Attachment{
			ID:          part.Path,
			Filename:    sanitizeFilename(name),
			ContentType: part.mediaType(),
			Size:        estimateDecodedSize(part),
			Inline:      part.Disposition == "inline" || (part.ContentID != "" && part.insideRelated()),
			ContentID:   part.ContentID,
		})
	}
	return results
}

// defaultFilename names an attachment that came without one.
func defaultFilename(part *mimePart) string {
	switch part.mediaType() {
	case "message/rfc822":
		return "Attached message.eml"
	case "text/calendar":
		return "invite.ics"
	case "text/html":
		return "attachment.html"
	case "text/plain":
		return "attachment.txt"
	}
	extensions, _ := mime.ExtensionsByType(part.mediaType())
	ext := ".bin"
	if len(extensions) > 0 {
		sort.Strings(extensions)
		ext = extensions[0]
		for _, candidate := range extensions {
			if len(candidate) == 4 {
				ext = candidate
				break
			}
		}
	}
	return "attachment" + ext
}

// estimateDecodedSize turns a transfer-encoded size into the file size.
func estimateDecodedSize(part *mimePart) int64 {
	if part.body != nil {
		return int64(len(part.body))
	}
	if part.Encoding == "base64" {
		return part.Size * 3 / 4
	}
	return part.Size
}

// sanitizeFilename strips characters that are unsafe in file names.
func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "'", "<", "(", ">", ")", "|", "_", "\x00", "")
	name = replacer.Replace(name)
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
	name = strings.Trim(name, ". ")
	if name == "" {
		return "attachment"
	}
	if len(name) > 200 {
		ext := ""
		if dot := strings.LastIndex(name, "."); dot > 0 && len(name)-dot <= 10 {
			ext = name[dot:]
		}
		name = truncateUTF8(name, 200-len(ext)) + ext
	}
	return name
}

func truncateUTF8(text string, max int) string {
	if len(text) <= max {
		return text
	}
	cut := max
	for cut > 0 && (text[cut]&0xC0) == 0x80 {
		cut--
	}
	return text[:cut]
}

// decodeTransfer undoes a Content-Transfer-Encoding. partial tolerates a
// truncated body (preview snippets fetched with a byte range).
func decodeTransfer(data []byte, encoding string, partial bool) []byte {
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "base64":
		cleaned := make([]byte, 0, len(data))
		for _, b := range data {
			if (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '+' || b == '/' || b == '=' {
				cleaned = append(cleaned, b)
			}
		}
		if partial {
			cleaned = cleaned[:len(cleaned)/4*4]
		}
		decoded := make([]byte, base64.StdEncoding.DecodedLen(len(cleaned)))
		n, err := base64.StdEncoding.Decode(decoded, cleaned)
		if err != nil {
			//Missing padding is common in the wild
			n2, err2 := base64.RawStdEncoding.Decode(decoded, bytes.TrimRight(cleaned, "="))
			if err2 == nil {
				return decoded[:n2]
			}
		}
		return decoded[:n]
	case "quoted-printable":
		reader := quotedprintable.NewReader(bytes.NewReader(data))
		decoded, err := io.ReadAll(reader)
		if err != nil && len(decoded) == 0 && !partial {
			return data
		}
		return decoded
	default:
		return data
	}
}

// decodeCharset converts text in charset to UTF-8, best effort.
func decodeCharset(data []byte, charsetName string) string {
	charsetName = strings.ToLower(strings.Trim(strings.TrimSpace(charsetName), "\"'"))
	switch charsetName {
	case "", "utf-8", "utf8", "us-ascii", "ascii":
		return strings.ToValidUTF8(string(data), "�")
	}
	reader, err := charset.Reader(charsetName, bytes.NewReader(data))
	if err != nil {
		return strings.ToValidUTF8(string(data), "�")
	}
	decoded, err := io.ReadAll(reader)
	if err != nil && len(decoded) == 0 {
		return strings.ToValidUTF8(string(data), "�")
	}
	return strings.ToValidUTF8(string(decoded), "�")
}

// partText decodes a text part's raw section (transfer encoding + charset).
func partText(part *mimePart, raw []byte, partial bool) string {
	if part.body != nil {
		//Local entities are already transfer-decoded and charset-converted
		//by go-message, which yields UTF-8.
		return strings.ToValidUTF8(string(part.body), "�")
	}
	return decodeCharset(decodeTransfer(raw, part.Encoding, partial), part.Params["charset"])
}

// decodeHeaderWords decodes RFC 2047 encoded words in any known charset.
func decodeHeaderWords(text string) string {
	if !strings.Contains(text, "=?") {
		return text
	}
	decoded, err := wordDecoder.DecodeHeader(text)
	if err != nil {
		return text
	}
	return decoded
}

// rfc2231Param reads a parameter that may use RFC 2231 extended syntax
// (name*=utf-8”..., or split into name*0*, name*1*, …).
func rfc2231Param(params map[string]string, key string) string {
	if value, ok := params[key]; ok && value != "" {
		return value
	}
	if value, ok := params[key+"*"]; ok && value != "" {
		return decodeRFC2231Value(value, true)
	}

	type segment struct {
		index   int
		value   string
		encoded bool
	}
	segments := []segment{}
	for name, value := range params {
		if !strings.HasPrefix(name, key+"*") {
			continue
		}
		rest := strings.TrimPrefix(name, key+"*")
		encoded := strings.HasSuffix(rest, "*")
		rest = strings.TrimSuffix(rest, "*")
		index, err := strconv.Atoi(rest)
		if err != nil {
			continue
		}
		segments = append(segments, segment{index: index, value: value, encoded: encoded})
	}
	if len(segments) == 0 {
		return ""
	}
	sort.Slice(segments, func(i, j int) bool { return segments[i].index < segments[j].index })

	charsetName := ""
	var builder bytes.Buffer
	for i, seg := range segments {
		value := seg.value
		if seg.encoded {
			if i == 0 {
				if parts := strings.SplitN(value, "'", 3); len(parts) == 3 {
					charsetName = parts[0]
					value = parts[2]
				}
			}
			if unescaped, err := url.PathUnescape(value); err == nil {
				value = unescaped
			}
		}
		builder.WriteString(value)
	}
	return decodeCharset(builder.Bytes(), charsetName)
}

func decodeRFC2231Value(value string, withCharset bool) string {
	charsetName := ""
	if withCharset {
		if parts := strings.SplitN(value, "'", 3); len(parts) == 3 {
			charsetName = parts[0]
			value = parts[2]
		}
	}
	if unescaped, err := url.PathUnescape(value); err == nil {
		value = unescaped
	}
	return decodeCharset([]byte(value), charsetName)
}
