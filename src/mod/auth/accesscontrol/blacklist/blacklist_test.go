package blacklist

import (
	"testing"

	"imuslab.com/arozos/mod/auth/accesscontrol"
)

func TestIpRangeBreakdown(t *testing.T) {
	ipRange := "192.168.1.155 - 192.168.1.158"
	sol := []string{"192.168.1.155", "192.168.1.156", "192.168.1.157", "192.168.1.158"}
	breakdown := accesscontrol.BreakdownIpRange(ipRange)
	if len(sol) != len(breakdown) {
		t.Fatal("IP range breakdown length incorrect, result: ", breakdown)
	} else {
		t.Log("Returned IP Range: ", breakdown, " Solution: ", sol)
	}
}

func TestIpInRange(t *testing.T) {
	r := accesscontrol.IpInRange("192.168.1.128", "192.168.1.100 - 192.168.1.200")
	if r == false {
		t.Fatal("Correct IP in range reported as error")
	}

	r = accesscontrol.IpInRange("192.168.1.128", "192.168.1.128 ")
	if r == false {
		t.Fatal("Correct IP in range reported as error")
	}

	r = accesscontrol.IpInRange("192.168.1.128", "192.168.1.1 - 192.168.1.100")
	if r == true {
		t.Fatal("Invalid IP in range reported as correct")
	}

}

func TestSingleIP(t *testing.T) {
	err := accesscontrol.ValidateIpRange("192.168.1.128")
	if err != nil {
		t.Fatal("Correct IP range reported as error", err)
	}

	err = accesscontrol.ValidateIpRange("192.168.1.asd")
	if err == nil {
		t.Fatal("Invalid ip reported as correct", err)
	}

	err = accesscontrol.ValidateIpRange("192.168.1.100.123.234")
	if err == nil {
		t.Fatal("Invalid ip reported as correct", err)
	}

}
func TestIPRange(t *testing.T) {
	err := accesscontrol.ValidateIpRange("192.168.1.150 - 192.168.1.250")
	if err != nil {
		t.Fatal("Correct IP range reported as error", err)
	}

	err = accesscontrol.ValidateIpRange("192.168.1.1 - 192.168.1.100")
	if err != nil {
		t.Fatal("Correct IP range reported as error", err)
	}

	err = accesscontrol.ValidateIpRange("192.168.1.255 - 192.168.1.250")
	if err == nil {
		t.Fatal("Invalid correct resp on starting ip > ending ip", err)
	}

	err = accesscontrol.ValidateIpRange("192.168.1.120 -192.168.2.100")
	if err == nil {
		t.Fatal("Invalid ip range reported as correct", err)
	}

	err = accesscontrol.ValidateIpRange("d037:b377:039a:b621:145b:0d10:3d38:982f - 4fe9:1561:c37c:1f66:f696:948d:c452:73a3")
	if err == nil {
		t.Fatal("Not supported ip range reported as correct", err)
	}
}
