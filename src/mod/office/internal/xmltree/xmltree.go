/*
Package xmltree is the generic XML tree the OOXML readers walk.

OOXML is far too large to model with rigid structs for the subset the
editors consume, so every part is parsed into a Node tree and walked by
local element name (namespace prefixes are ignored - a:off, p:off and
dgm:off all read as "off"). It also holds the package relationship
plumbing (.rels parts, part path resolution) the docx, xlsx and pptx
readers share, and the XML escaping their writers use.
*/
package xmltree

import (
	"encoding/xml"
	"path"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// Escape escapes a string for use inside XML text nodes and attributes
func Escape(s string) string {
	if logger.IsDebug() {
		logger.Debugf("office/internal/xmltree", "Escape: s=%.120q", s)
	}
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}

// ResolvePart resolves a (possibly relative) rels target against a base dir
func ResolvePart(baseDir, target string) string {
	if logger.IsDebug() {
		logger.Debugf("office/internal/xmltree", "ResolvePart: baseDir=%.120q target=%.120q", baseDir, target)
	}
	if strings.HasPrefix(target, "/") {
		return strings.TrimPrefix(target, "/")
	}
	return path.Clean(path.Join(baseDir, target))
}

// Node is a generic XML tree node
type Node struct {
	XMLName xml.Name
	Attrs   []xml.Attr `xml:",any,attr"`
	Nodes   []Node     `xml:",any"`
	Text    string     `xml:",chardata"`
}

func (n *Node) Attr(local string) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/internal/xmltree", "Node.Attr: local=%.120q", local)
	}
	if n == nil {
		return ""
	}
	for _, a := range n.Attrs {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// attrNS returns an attribute matching both a namespace URI suffix and a
// local name - needed for r:id, which collides with the plain "id" attribute
func (n *Node) AttrNS(nsSuffix, local string) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/internal/xmltree", "Node.AttrNS: nsSuffix=%.120q local=%.120q", nsSuffix, local)
	}
	if n == nil {
		return ""
	}
	for _, a := range n.Attrs {
		if a.Name.Local == local && strings.HasSuffix(a.Name.Space, nsSuffix) {
			return a.Value
		}
	}
	return ""
}

// first returns the first direct child with the given local name
func (n *Node) First(local string) *Node {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/internal/xmltree", "Node.First: local=%.120q", local)
	}
	if n == nil {
		return nil
	}
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			return &n.Nodes[i]
		}
	}
	return nil
}

// path walks nested first() lookups; returns nil when any hop is missing
func (n *Node) Path(locals ...string) *Node {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/internal/xmltree", "Node.Path: len(locals)=%d", len(locals))
	}
	cur := n
	for _, l := range locals {
		cur = cur.First(l)
		if cur == nil {
			return nil
		}
	}
	return cur
}

// all returns every direct child with the given local name
func (n *Node) All(local string) []*Node {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/internal/xmltree", "Node.All: local=%.120q", local)
	}
	if n == nil {
		return nil
	}
	var out []*Node
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			out = append(out, &n.Nodes[i])
		}
	}
	return out
}

// findAll walks the whole subtree collecting elements with the given name
func (n *Node) FindAll(local string, out *[]*Node) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("office/internal/xmltree", "Node.FindAll: local=%.120q", local)
	}
	if n == nil {
		return
	}
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			*out = append(*out, &n.Nodes[i])
		}
		n.Nodes[i].FindAll(local, out)
	}
}

func Parse(data []byte) (*Node, error) {
	logger.Debug("office/internal/xmltree", "Parse")
	root := Node{}
	if err := xml.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	return &root, nil
}

// ParseRels maps rId -> target path from a .rels part. Shared with the
// docx and xlsx readers, which use the same relationship plumbing.
func ParseRels(data []byte) map[string]string {
	logger.Debug("office/internal/xmltree", "ParseRels")
	out := map[string]string{}
	if data == nil {
		return out
	}
	tree, err := Parse(data)
	if err != nil {
		return out
	}
	for _, rel := range tree.All("Relationship") {
		out[rel.Attr("Id")] = rel.Attr("Target")
	}
	return out
}

// CollectText gathers every <a:t> text node under n
func CollectText(n *Node, out *[]string) {
	logger.DebugTrace("office/internal/xmltree", "CollectText")
	if n.XMLName.Local == "t" {
		if strings.TrimSpace(n.Text) != "" {
			*out = append(*out, n.Text)
		}
		return
	}
	for i := range n.Nodes {
		CollectText(&n.Nodes[i], out)
	}
}
