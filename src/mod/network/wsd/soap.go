package wsd

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

/*
	soap.go

	The few SOAP 1.2 messages of WS-Discovery (2005/04, the version Windows
	speaks) and of the DPWS metadata exchange. Incoming messages are read with
	encoding/xml, keeping track of namespace declarations, because the types a
	Probe asks for are QNames whose prefixes the sender chooses.
*/

const (
	nsSOAP      = "http://www.w3.org/2003/05/soap-envelope"
	nsAddress   = "http://schemas.xmlsoap.org/ws/2004/08/addressing"
	nsDiscovery = "http://schemas.xmlsoap.org/ws/2005/04/discovery"
	nsDevProf   = "http://schemas.xmlsoap.org/ws/2006/02/devprof"
	nsPub       = "http://schemas.microsoft.com/windows/pub/2005/07"
	nsMex       = "http://schemas.xmlsoap.org/ws/2004/09/mex"
	nsPnpx      = "http://schemas.microsoft.com/windows/pnpx/2005/10"

	toDiscovery = "urn:schemas-xmlsoap-org:ws:2005:04:discovery"
	toAnonymous = "http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous"

	actionHello          = nsDiscovery + "/Hello"
	actionBye            = nsDiscovery + "/Bye"
	actionProbe          = nsDiscovery + "/Probe"
	actionProbeMatches   = nsDiscovery + "/ProbeMatches"
	actionResolve        = nsDiscovery + "/Resolve"
	actionResolveMatches = nsDiscovery + "/ResolveMatches"
	actionGet            = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Get"
	actionGetResponse    = "http://schemas.xmlsoap.org/ws/2004/09/transfer/GetResponse"
)

// qname is a type a Probe asks for, with its namespace resolved.
type qname struct{ space, local string }

// ourTypes are what this host is: a device that is a Windows style computer.
var ourTypes = []qname{{nsDevProf, "Device"}, {nsPub, "Computer"}}

// message is what the responder needs of an incoming SOAP message.
type message struct {
	action    string
	messageID string
	types     []qname //Probe
	hasScopes bool    //Probe with scopes, which this host has none of
	address   string  //Resolve
}

// parseMessage reads a SOAP envelope. It stops at the first problem, as
// anything malformed is simply not answered.
func parseMessage(data []byte) (*message, error) {
	d := xml.NewDecoder(bytes.NewReader(data))
	type scope map[string]string
	scopes := []scope{{}}
	lookup := func(prefix string) string {
		for i := len(scopes) - 1; i >= 0; i-- {
			if ns, ok := scopes[i][prefix]; ok {
				return ns
			}
		}
		return ""
	}

	m := &message{}
	path := []string{}
	var text strings.Builder
	for {
		tok, err := d.RawToken()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			s := scope{}
			for _, a := range t.Attr {
				if a.Name.Space == "xmlns" {
					s[a.Name.Local] = a.Value
				} else if a.Name.Space == "" && a.Name.Local == "xmlns" {
					s[""] = a.Value
				}
			}
			scopes = append(scopes, s)
			path = append(path, lookup(t.Name.Space)+" "+t.Name.Local)
			text.Reset()
			if len(path) > 16 {
				return nil, fmt.Errorf("wsd: message nested too deep")
			}
		case xml.CharData:
			if text.Len()+len(t) < 4096 {
				text.Write(t)
			}
		case xml.EndElement:
			value := strings.TrimSpace(text.String())
			switch strings.Join(path, "/") {
			case nsSOAP + " Envelope/" + nsSOAP + " Header/" + nsAddress + " Action":
				m.action = value
			case nsSOAP + " Envelope/" + nsSOAP + " Header/" + nsAddress + " MessageID":
				m.messageID = value
			case nsSOAP + " Envelope/" + nsSOAP + " Body/" + nsDiscovery + " Probe/" + nsDiscovery + " Types":
				for _, field := range strings.Fields(value) {
					prefix, local := "", field
					if i := strings.IndexByte(field, ':'); i >= 0 {
						prefix, local = field[:i], field[i+1:]
					}
					m.types = append(m.types, qname{lookup(prefix), local})
				}
			case nsSOAP + " Envelope/" + nsSOAP + " Body/" + nsDiscovery + " Probe/" + nsDiscovery + " Scopes":
				m.hasScopes = value != ""
			case nsSOAP + " Envelope/" + nsSOAP + " Body/" + nsDiscovery + " Resolve/" + nsAddress + " EndpointReference/" + nsAddress + " Address":
				m.address = value
			}
			text.Reset()
			if len(path) > 0 {
				path = path[:len(path)-1]
				scopes = scopes[:len(scopes)-1]
			}
		}
	}
	if m.action == "" {
		return nil, fmt.Errorf("wsd: no action")
	}
	return m, nil
}

// matchesProbe reports whether a Probe is looking for this host.
func (m *message) matchesProbe() bool {
	if m.hasScopes {
		return false
	}
	for _, want := range m.types {
		found := false
		for _, have := range ourTypes {
			if want == have {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func escape(s string) string {
	var b bytes.Buffer
	xml.EscapeText(&b, []byte(s))
	return b.String()
}

const envelopeStart = `<?xml version="1.0" encoding="utf-8"?>` +
	`<soap:Envelope xmlns:soap="` + nsSOAP + `" xmlns:wsa="` + nsAddress + `" xmlns:wsd="` + nsDiscovery +
	`" xmlns:wsdp="` + nsDevProf + `" xmlns:pub="` + nsPub + `" xmlns:wsx="` + nsMex + `" xmlns:pnpx="` + nsPnpx + `">`

// envelope wraps a body in the headers every message carries.
func envelope(to, action, messageID, relatesTo, appSequence, body string) []byte {
	var b strings.Builder
	b.WriteString(envelopeStart)
	b.WriteString("<soap:Header>")
	b.WriteString("<wsa:To>" + escape(to) + "</wsa:To>")
	b.WriteString("<wsa:Action>" + escape(action) + "</wsa:Action>")
	b.WriteString("<wsa:MessageID>" + escape(messageID) + "</wsa:MessageID>")
	if relatesTo != "" {
		b.WriteString("<wsa:RelatesTo>" + escape(relatesTo) + "</wsa:RelatesTo>")
	}
	b.WriteString(appSequence)
	b.WriteString("</soap:Header><soap:Body>")
	b.WriteString(body)
	b.WriteString("</soap:Body></soap:Envelope>")
	return []byte(b.String())
}

func endpoint(uuid string) string {
	return "<wsa:EndpointReference><wsa:Address>urn:uuid:" + escape(uuid) + "</wsa:Address></wsa:EndpointReference>"
}

const typesText = "wsdp:Device pub:Computer"

func xaddrs(ip string, port int, uuid string) string {
	host := ip
	if strings.Contains(ip, ":") {
		host = "[" + ip + "]"
	}
	return fmt.Sprintf("http://%s:%d/%s", host, port, uuid)
}

// metadata is the GetResponse body: what Windows shows for the computer and
// the name it opens when the icon is double clicked.
func metadata(uuid, name, workgroup string) string {
	computer := escape(name) + "/Workgroup:" + escape(workgroup)
	return `<wsx:Metadata>` +
		`<wsx:MetadataSection Dialect="` + nsDevProf + `/ThisDevice"><wsdp:ThisDevice>` +
		`<wsdp:FriendlyName>WSD Device ` + escape(name) + `</wsdp:FriendlyName>` +
		`<wsdp:FirmwareVersion>1.0</wsdp:FirmwareVersion><wsdp:SerialNumber>1</wsdp:SerialNumber>` +
		`</wsdp:ThisDevice></wsx:MetadataSection>` +
		`<wsx:MetadataSection Dialect="` + nsDevProf + `/ThisModel"><wsdp:ThisModel>` +
		`<wsdp:Manufacturer>ArozOS</wsdp:Manufacturer><wsdp:ModelName>ArozOS</wsdp:ModelName>` +
		`<pnpx:DeviceCategory>Computers</pnpx:DeviceCategory>` +
		`</wsdp:ThisModel></wsx:MetadataSection>` +
		`<wsx:MetadataSection Dialect="` + nsDevProf + `/Relationship">` +
		`<wsdp:Relationship Type="` + nsDevProf + `/host"><wsdp:Host>` + endpoint(uuid) +
		`<wsdp:Types>pub:Computer</wsdp:Types><wsdp:ServiceId>urn:uuid:` + escape(uuid) + `</wsdp:ServiceId>` +
		`<pub:Computer>` + computer + `</pub:Computer>` +
		`</wsdp:Host></wsdp:Relationship></wsx:MetadataSection>` +
		`</wsx:Metadata>`
}
