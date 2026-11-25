package wakeonlan

import (
	"errors"
	"net"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Wake On Lan
	Author: tobychui

	This module send wake on LAN signal to a given MAC address
	and do nothing else
*/

type magicPacket [102]byte

func WakeTarget(macAddr string) (out0 error) {
	defer logger.Out1(logger.In1("cluster/wakeonlan", "WakeTarget", "macAddr", macAddr), &out0)
	packet := magicPacket{}
	mac, err := net.ParseMAC(macAddr)
	if err != nil {
		logger.DebugErr("cluster/wakeonlan", err)
		return err
	}

	if len(mac) != 6 {
		return errors.New("Invalid MAC address")
	}

	//Initialize the packet with all F
	copy(packet[0:], []byte{255, 255, 255, 255, 255, 255})
	offset := 6

	for i := 0; i < 16; i++ {
		copy(packet[offset:], mac)
		offset += 6
	}

	//Most devices listen to either port 7 or 9, send to both of them
	err = sendPacket("255.255.255.255:7", packet)
	if err != nil {
		logger.DebugErr("cluster/wakeonlan", err)
		return err
	}

	time.Sleep(30 * time.Millisecond)

	err = sendPacket("255.255.255.255:9", packet)
	if err != nil {
		logger.DebugErr("cluster/wakeonlan", err)
		return err
	}
	return nil
}

func sendPacket(addr string, packet magicPacket) (out0 error) {
	defer logger.Out1(logger.In2("cluster/wakeonlan", "sendPacket", "addr", addr, "&packet", &packet), &out0)
	conn, err := net.Dial("udp", addr)
	if err != nil {
		logger.DebugErr("cluster/wakeonlan", err)
		return err
	}
	defer conn.Close()

	_, err = conn.Write(packet[:])
	return err
}
