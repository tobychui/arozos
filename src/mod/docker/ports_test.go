package docker

import (
	"reflect"
	"testing"
)

func TestParsePublishedPorts(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		targets []string
	}{
		{"ipv4 and ipv6 duplicates", "0.0.0.0:8081->80/tcp, :::8081->80/tcp", []string{"127.0.0.1:8081"}},
		{"bracketed ipv6", "[::]:9000->9000/tcp", []string{"127.0.0.1:9000"}},
		{"bound to one address", "192.168.0.10:8443->443/tcp", []string{"192.168.0.10:8443"}},
		{"not published", "80/tcp, 443/tcp", []string{}},
		{"udp skipped", "0.0.0.0:53->53/udp, 0.0.0.0:5380->80/tcp", []string{"127.0.0.1:5380"}},
		{"range", "0.0.0.0:8000-8002->8000-8002/tcp", []string{"127.0.0.1:8000", "127.0.0.1:8001", "127.0.0.1:8002"}},
		{"empty", "", []string{}},
		{"garbage", "nonsense->x/tcp", []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := []string{}
			for _, p := range ParsePublishedPorts(tt.in) {
				got = append(got, p.Target())
			}
			if !reflect.DeepEqual(got, tt.targets) {
				t.Errorf("targets = %v, want %v", got, tt.targets)
			}
		})
	}
}

func TestParsePublishedPortsContainerPort(t *testing.T) {
	ports := ParsePublishedPorts("0.0.0.0:8081->80/tcp")
	if len(ports) != 1 || ports[0].ContainerPort != 80 || ports[0].HostPort != 8081 || ports[0].Protocol != "tcp" {
		t.Errorf("ports = %+v", ports)
	}
}
