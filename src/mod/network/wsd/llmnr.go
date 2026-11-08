package wsd

import (
	"encoding/binary"
	"net"
	"strings"

	"golang.org/x/net/ipv4"
)

/*
	llmnr.go

	Link-Local Multicast Name Resolution (RFC 4795) for one name. Windows
	opens \\NAME when the computer is double clicked in the Network view, and
	finds NAME with LLMNR when no DNS server knows it. Only the announced name
	is ever answered; every other query is left to whoever owns it.
*/

const (
	dnsTypeA    = 1
	dnsTypeAAAA = 28
	dnsTypeANY  = 255
	dnsClassIN  = 1
)

// llmnrQuery is the one question of an LLMNR query.
type llmnrQuery struct {
	id       uint16
	name     string
	qtype    uint16
	question []byte //As sent, for the answer to repeat
}

// parseLLMNR reads a query with one question. Responses, updates and
// anything with more than one question are not for a responder.
func parseLLMNR(b []byte) (*llmnrQuery, bool) {
	if len(b) < 12 {
		return nil, false
	}
	flags := binary.BigEndian.Uint16(b[2:])
	if flags&0x8000 != 0 || flags&0x7800 != 0 {
		return nil, false
	}
	if binary.BigEndian.Uint16(b[4:]) != 1 || binary.BigEndian.Uint16(b[6:]) != 0 || binary.BigEndian.Uint16(b[8:]) != 0 {
		return nil, false
	}
	q := &llmnrQuery{id: binary.BigEndian.Uint16(b)}
	labels := []string{}
	off := 12
	for {
		if off >= len(b) {
			return nil, false
		}
		n := int(b[off])
		off++
		if n == 0 {
			break
		}
		if n > 63 || off+n > len(b) || len(labels) > 8 {
			return nil, false
		}
		labels = append(labels, string(b[off:off+n]))
		off += n
	}
	if off+4 > len(b) {
		return nil, false
	}
	q.name = strings.Join(labels, ".")
	q.qtype = binary.BigEndian.Uint16(b[off:])
	if binary.BigEndian.Uint16(b[off+2:]) != dnsClassIN {
		return nil, false
	}
	q.question = b[12 : off+4]
	return q, true
}

// isOurName compares case insensitively, as Windows upper cases names.
func (r *Responder) isOurName(name string) bool {
	return strings.EqualFold(name, r.cfg.Name)
}

// llmnrAnswer builds the response. A query for AAAA gets an empty answer at
// once, so Windows does not wait out its timeout before using the A record.
func llmnrAnswer(q *llmnrQuery, ip net.IP) []byte {
	answers := 0
	if (q.qtype == dnsTypeA || q.qtype == dnsTypeANY) && ip.To4() != nil {
		answers = 1
	}
	out := make([]byte, 12, 12+len(q.question)+16)
	binary.BigEndian.PutUint16(out, q.id)
	binary.BigEndian.PutUint16(out[2:], 0x8000) //Response, not conflicted
	binary.BigEndian.PutUint16(out[4:], 1)
	binary.BigEndian.PutUint16(out[6:], uint16(answers))
	out = append(out, q.question...)
	if answers == 1 {
		rr := make([]byte, 16)
		binary.BigEndian.PutUint16(rr, 0xC00C) //The name of the question
		binary.BigEndian.PutUint16(rr[2:], dnsTypeA)
		binary.BigEndian.PutUint16(rr[4:], dnsClassIN)
		binary.BigEndian.PutUint32(rr[6:], 30)
		binary.BigEndian.PutUint16(rr[10:], 4)
		copy(rr[12:], ip.To4())
		out = append(out, rr...)
	}
	return out
}

func (r *Responder) serveLLMNR() {
	defer r.wg.Done()
	buf := make([]byte, 1500)
	for {
		n, cm, from, err := r.llmnr.ReadFrom(buf)
		if err != nil {
			if r.isClosed() {
				return
			}
			continue
		}
		q, ok := parseLLMNR(buf[:n])
		if !ok || !r.isOurName(q.name) {
			continue
		}
		if q.qtype != dnsTypeA && q.qtype != dnsTypeAAAA && q.qtype != dnsTypeANY {
			continue
		}
		ip := replyIP(cm, from)
		if ip == nil {
			continue
		}
		reply := llmnrAnswer(q, ip)
		var out *ipv4.ControlMessage
		if cm != nil && cm.IfIndex > 0 {
			out = &ipv4.ControlMessage{IfIndex: cm.IfIndex}
		}
		if _, err := r.llmnr.WriteTo(reply, out, from); err != nil && out != nil {
			r.llmnr.WriteTo(reply, nil, from)
		}
	}
}
