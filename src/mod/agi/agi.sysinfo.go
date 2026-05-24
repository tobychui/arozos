package agi

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/disk/diskspace"
	usageinfo "imuslab.com/arozos/mod/info/usageinfo"
	"imuslab.com/arozos/mod/network/netstat"
)

/*
	AGI System Info Library
	Author: tobychui

	Exposes CPU, RAM and network usage to AGI scripts via the "sysinfo" library.
	Usage in AGI:
	    requirelib("sysinfo");
	    var cpu = sysinfo.getCPUUsage();          // float percentage 0-100
	    var ram = sysinfo.getRAMUsage();           // {used, total, percent}
	    var net = sysinfo.getNetworkUsage();       // {rxRate, txRate, rxTotal, txTotal}
*/

// networkSample holds a single point-in-time reading of cumulative network bytes.
type networkSample struct {
	rxBytes   int64
	txBytes   int64
	timestamp time.Time
}

var (
	netMu         sync.Mutex
	prevNetSample *networkSample
)

func (g *Gateway) SysinfoLibRegister() {
	err := g.RegisterLib("sysinfo", g.injectSysinfoLibFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectSysinfoLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM

	// CPU Usage – returns a float64 percentage (0–100)
	vm.Set("_sysinfo_getcpu", func(call otto.FunctionCall) otto.Value {
		usage := usageinfo.GetCPUUsage()
		result, _ := vm.ToValue(usage)
		return result
	})

	// RAM Usage – returns JSON {used, total, percent}
	vm.Set("_sysinfo_getram", func(call otto.FunctionCall) otto.Value {
		used, total := usageinfo.GetNumericRAMUsage()
		percent := float64(0)
		if total > 0 {
			percent = float64(used) / float64(total) * 100.0
		}
		resp := map[string]interface{}{
			"used":    used,
			"total":   total,
			"percent": percent,
		}
		js, _ := json.Marshal(resp)
		result, _ := vm.ToValue(string(js))
		return result
	})

	// Network Usage – returns JSON {rxRate, txRate, rxTotal, txTotal} (bytes and bytes/sec)
	vm.Set("_sysinfo_getnet", func(call otto.FunctionCall) otto.Value {
		rxRate, txRate, rxTotal, txTotal := getNetworkUsage()
		resp := map[string]interface{}{
			"rxRate":  rxRate,
			"txRate":  txRate,
			"rxTotal": rxTotal,
			"txTotal": txTotal,
		}
		js, _ := json.Marshal(resp)
		result, _ := vm.ToValue(string(js))
		return result
	})

	// Disk Info – returns JSON array of logical disk volumes
	vm.Set("_sysinfo_getdisk", func(call otto.FunctionCall) otto.Value {
		disks := diskspace.GetAllLogicDiskInfo()
		js, _ := json.Marshal(disks)
		result, _ := vm.ToValue(string(js))
		return result
	})

	//nolint:errcheck
	vm.Run(`
		var sysinfo = {};
		sysinfo.getCPUUsage = function() {
			return _sysinfo_getcpu();
		};
		sysinfo.getRAMUsage = function() {
			var raw = _sysinfo_getram();
			try { return JSON.parse(raw); } catch(e) { return {used: -1, total: -1, percent: 0}; }
		};
		sysinfo.getNetworkUsage = function() {
			var raw = _sysinfo_getnet();
			try { return JSON.parse(raw); } catch(e) { return {rxRate: 0, txRate: 0, rxTotal: 0, txTotal: 0}; }
		};
		sysinfo.getDiskInfo = function() {
			var raw = _sysinfo_getdisk();
			try { return JSON.parse(raw); } catch(e) { return []; }
		};
	`)
}

// getNetworkUsage returns byte rates and totals by delegating to the shared
// netstat.GetNetworkInterfaceStats helper (supports Linux, Darwin, Windows).
// GetNetworkInterfaceStats returns accumulated bits, so we convert to bytes before
// computing the per-second rate against the previous sample.
func getNetworkUsage() (rxRate float64, txRate float64, rxTotal int64, txTotal int64) {
	rxBits, txBits, err := netstat.GetNetworkInterfaceStats()
	if err != nil {
		return 0, 0, 0, 0
	}
	// Convert accumulated bits → bytes
	rx := rxBits / 8
	tx := txBits / 8

	now := time.Now()
	netMu.Lock()
	defer netMu.Unlock()

	if prevNetSample != nil {
		elapsed := now.Sub(prevNetSample.timestamp).Seconds()
		if elapsed > 0 {
			rxRate = float64(rx-prevNetSample.rxBytes) / elapsed
			txRate = float64(tx-prevNetSample.txBytes) / elapsed
			if rxRate < 0 {
				rxRate = 0
			}
			if txRate < 0 {
				txRate = 0
			}
		}
	}

	prevNetSample = &networkSample{
		rxBytes:   rx,
		txBytes:   tx,
		timestamp: now,
	}
	return rxRate, txRate, rx, tx
}
