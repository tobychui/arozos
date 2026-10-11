package officeart

/*
	shape.go - shape containers and group trees.

	A drawing (OfficeArtDgContainer) holds one group container, the
	patriarch, whose first member is the group's own shape record and the
	rest its shapes and nested groups. A group maps its children from its
	own coordinate space (FSPGR) onto the rectangle it occupies; the
	children are anchored in that space (ChildAnchor) while top level
	shapes use the host's client anchor.
*/

import "encoding/binary"

// Shape is one decoded shape container
type Shape struct {
	// Type is the MSOSPT shape type (1 rectangle, 75 picture frame, 202
	// text box, 0 a freeform drawn with vertices)
	Type  uint16
	ID    uint32
	Flags uint32
	// Props merges the primary, secondary and tertiary tables
	Props Props
	// ClientAnchor / ClientData / ClientTextbox are host specific records
	ClientAnchor  *Record
	ClientData    *Record
	ClientTextbox *Record
	// Child is the anchor inside the parent group's space (l, t, r, b)
	Child *[4]int32
	// Group is set for a group shape: its coordinate space (l, t, r, b)
	// and its members in drawing order
	Group    *[4]int32
	Children []*Shape
	// Container is the SpContainer (or SpgrContainer for a group)
	Container *Record
}

// IsGroup reports a group shape
func (s *Shape) IsGroup() bool { return s != nil && s.Group != nil }

// FlipH / FlipV report the mirroring flags
func (s *Shape) FlipH() bool { return s.Flags&SpFlipH != 0 }
func (s *Shape) FlipV() bool { return s.Flags&SpFlipV != 0 }

// Deleted reports a shape the host marked as deleted
func (s *Shape) Deleted() bool { return s.Flags&SpDeleted != 0 }

func rect32(b []byte) *[4]int32 {
	if len(b) < 16 {
		return nil
	}
	le := binary.LittleEndian
	return &[4]int32{int32(le.Uint32(b)), int32(le.Uint32(b[4:])), int32(le.Uint32(b[8:])), int32(le.Uint32(b[12:]))}
}

// ReadShape decodes an SpContainer
func ReadShape(sp *Record) *Shape {
	s := &Shape{Container: sp}
	props := Props{vals: map[uint16]uint32{}, complex: map[uint16][]byte{}, blip: map[uint16]bool{}}
	for _, c := range sp.Children {
		switch c.Type {
		case FSP:
			s.Type = c.Instance
			if len(c.Data) >= 8 {
				s.ID = binary.LittleEndian.Uint32(c.Data)
				s.Flags = binary.LittleEndian.Uint32(c.Data[4:])
			}
		case FSPGR:
			s.Group = rect32(c.Data)
		case FOPT, SecondaryFOPT, TertiaryFOPT:
			props = props.Merge(ParseProps(c))
		case ClientAnchor:
			s.ClientAnchor = c
		case ChildAnchor:
			s.Child = rect32(c.Data)
		case ClientData:
			s.ClientData = c
		case ClientTextbox:
			s.ClientTextbox = c
		}
	}
	s.Props = props
	return s
}

// ReadGroup decodes an SpgrContainer into its group shape with the
// members as Children (nested groups included)
func ReadGroup(spgr *Record) *Shape {
	if spgr == nil || len(spgr.Children) == 0 {
		return nil
	}
	var g *Shape
	for i, c := range spgr.Children {
		switch c.Type {
		case SpContainer:
			sh := ReadShape(c)
			if i == 0 {
				g = sh
				g.Container = spgr
				if g.Group == nil {
					g.Group = &[4]int32{0, 0, 0, 0}
				}
				continue
			}
			if g != nil {
				g.Children = append(g.Children, sh)
			}
		case SpgrContainer:
			if g != nil {
				if sub := ReadGroup(c); sub != nil {
					g.Children = append(g.Children, sub)
				}
			}
		}
	}
	return g
}

// Walk calls fn for every shape below s (s included), depth first, with
// the chain of groups above it
func Walk(s *Shape, fn func(sh *Shape, parents []*Shape)) {
	var walk func(*Shape, []*Shape)
	walk = func(n *Shape, up []*Shape) {
		fn(n, up)
		for _, c := range n.Children {
			walk(c, append(up[:len(up):len(up)], n))
		}
	}
	if s != nil {
		walk(s, nil)
	}
}
