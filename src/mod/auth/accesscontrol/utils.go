package accesscontrol

import (
	"bytes"
	"errors"
	"net"
	"strconv"
	"strings"
)

//Break an ip range text into independent ip strings
func BreakdownIpRange(ipRange string) []string {
	ipRange = strings.ReplaceAll(ipRange, " ", "")
	err := ValidateIpRange(ipRange)
	if err != nil {
		return []string{}
	}
	if !strings.Contains(ipRange, "-") {
		//This is not an ip range but a single ip
		return []string{ipRange}
	}

	//Break down the IP range
	results := []string{}
	ips := strings.Split(ipRange, "-")

	subnet := ips[0][:strings.LastIndex(ips[0], ".")]
	startD := ips[0][strings.LastIndex(ips[0], ".")+1:]
	if err != nil {
		return []string{}
	}
	endD := ips[1][strings.LastIndex(ips[0], ".")+1:]
	if err != nil {
		return []string{}
	}

	startDInt, err := strconv.Atoi(startD)
	endDInt, err := strconv.Atoi(endD)

	currentDInt := startDInt
	for currentDInt < endDInt+1 {
		results = append(results, subnet+"."+strconv.Itoa(currentDInt))
		currentDInt++
	}

	return results
}

//Check if an given ip in the given range
func IpInRange(ip string, ipRange string) bool {
	ip = strings.TrimSpace(ip)
	ipRange = strings.ReplaceAll(ipRange, " ", "")
	if ip == ipRange {
		//For fields that the ipRange is the ip itself
		return true
	}

	//Try matching range
	if strings.Contains(ipRange, "-") {
		//Parse the source IP
		trial := net.ParseIP(ip)

		//Parse the IP range
		ips := strings.Split(ipRange, "-")
		ip1 := net.ParseIP(ips[0])
		if ip1 == nil {
			return false
		}
		ip2 := net.ParseIP(ips[1])
		if ip2 == nil {
			return false
		}
		if trial.To4() == nil {
			return false
		}
		if bytes.Compare(trial, ip1) >= 0 && bytes.Compare(trial, ip2) <= 0 {
			return true
		}
		return false

	}
	return false
}

//Check if the given IP Range string is actually an IP range
func ValidateIpRange(ipRange string) error {
	ipRange = strings.TrimSpace(ipRange)
	ipRange = strings.ReplaceAll(ipRange, " ", "")
	if strings.Contains(ipRange, "-") {
		//This is a range
		if strings.Count(ipRange, "-") != 1 {
			//Invalid range defination
			return errors.New("Invalid ip range defination")
		}
		ips := strings.Split(ipRange, "-")
		//Check if the starting IP and ending IP are both valid
		if net.ParseIP(ips[0]) == nil {
			return errors.New("Starting ip is invalid")
		}

		if net.ParseIP(ips[1]) == nil {
			return errors.New("Ending ip is invalid")
		}

		//Check if the ending IP is larger than the starting IP
		startingIpInt, _ := strconv.Atoi(strings.ReplaceAll(ips[0], ".", ""))
		endingIpInt, _ := strconv.Atoi(strings.ReplaceAll(ips[1], ".", ""))

		if startingIpInt >= endingIpInt {
			return errors.New("Invalid ip range: Starting IP is larger or equal to ending ip")
		}

		//Check if they are in the same subnet
		startSubnet := ips[0][:strings.LastIndex(ips[0], ".")]
		endSubnet := ips[1][:strings.LastIndex(ips[1], ".")]

		if startSubnet != endSubnet {
			//They are not in the same subnet
			return errors.New("IP range subnet mismatch")
		}

	} else {
		//This is a single IP instead of range. Check if it is a valid IP addr
		if net.ParseIP(ipRange) != nil {
			//Ok
			return nil
		} else {
			return errors.New("Invalid ip given")
		}
	}

	return nil
}
