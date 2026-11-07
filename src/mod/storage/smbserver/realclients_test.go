//go:build !windows

package smbserver

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	Tests against Samba's own client tools, when they are installed. These
	count most: smbclient and rpcclient share no code with this server.
*/

func needTool(t *testing.T, name string) string {
	t.Helper()
	p, err := exec.LookPath(name)
	if err != nil {
		t.Skipf("%s is not installed", name)
	}
	return p
}

func authFile(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "auth")
	content := fmt.Sprintf("username = %s\npassword = %s\ndomain = WORKGROUP\n", testUserName, testPassword)
	if err := os.WriteFile(p, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return p
}

func emptyConf(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "smb.conf")
	os.WriteFile(p, []byte("[global]\n"), 0644)
	return p
}

func runTool(t *testing.T, tool string, args ...string) (string, error) {
	t.Helper()
	out, err := exec.Command(tool, args...).CombinedOutput()
	return string(out), err
}

func TestSmbclientEveryDialectAndSignature(t *testing.T) {
	tool := needTool(t, "smbclient")
	cases := []struct {
		name     string
		protocol string
		signing  string
	}{
		{"2.1 HMAC", "SMB2_10", ""},
		{"3.0 CMAC", "SMB3_00", ""},
		{"3.0.2 CMAC", "SMB3_02", ""},
		{"3.1.1 GMAC", "SMB3_11", "AES-128-GMAC"},
		{"3.1.1 CMAC", "SMB3_11", "AES-128-CMAC"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := newHarness(t)
			work := t.TempDir()
			data := make([]byte, 20<<20+777)
			rand.Read(data)
			want := sha256.Sum256(data)
			src := filepath.Join(work, "src.bin")
			back := filepath.Join(work, "back.bin")
			os.WriteFile(src, data, 0644)

			args := []string{
				"//127.0.0.1/data", "-p", h.port, "-A", authFile(t), "--configfile=" + emptyConf(t),
				"--option=client min protocol=" + c.protocol, "--option=client max protocol=" + c.protocol,
				"--option=client signing=required",
			}
			if c.signing != "" {
				args = append(args, "--option=client smb3 signing algorithms="+c.signing)
			}
			script := fmt.Sprintf("put %s up.bin; ls; mkdir newdir; cd newdir; put %s nested.bin; cd ..; rename up.bin moved.bin; get moved.bin %s; del moved.bin; cd newdir; del nested.bin; cd ..; rmdir newdir; ls", src, src, back)
			out, err := runTool(t, tool, append(args, "-c", script)...)
			if err != nil {
				t.Fatalf("%v\n%s", err, out)
			}
			if strings.Contains(out, "NT_STATUS") {
				t.Errorf("a command failed:\n%s", out)
			}
			got, err := os.ReadFile(back)
			if err != nil {
				t.Fatal(err)
			}
			if sha256.Sum256(got) != want {
				t.Error("the file came back different")
			}
			left, _ := os.ReadDir(h.share.root)
			if len(left) != 0 {
				t.Errorf("left behind: %v", left)
			}
		})
	}
}

func TestSmbclientListsShares(t *testing.T) {
	tool := needTool(t, "smbclient")
	h := newHarness(t)
	out, err := runTool(t, tool, "-L", "//127.0.0.1", "-p", h.port, "-A", authFile(t), "--configfile="+emptyConf(t), "--option=client min protocol=SMB3_11")
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	for _, want := range []string{"data", "Test drive data", "IPC$"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q:\n%s", want, out)
		}
	}
}

func TestSmbclientWrongPassword(t *testing.T) {
	tool := needTool(t, "smbclient")
	h := newHarness(t)
	bad := filepath.Join(t.TempDir(), "auth")
	os.WriteFile(bad, []byte("username = alice\npassword = wrong\n"), 0600)
	out, err := runTool(t, tool, "//127.0.0.1/data", "-p", h.port, "-A", bad, "--configfile="+emptyConf(t), "-c", "ls")
	if err == nil || !strings.Contains(out, "NT_STATUS_LOGON_FAILURE") {
		t.Errorf("err=%v\n%s", err, out)
	}
}

func TestSmbclientRefusesAnonymous(t *testing.T) {
	tool := needTool(t, "smbclient")
	h := newHarness(t)
	out, err := runTool(t, tool, "-L", "//127.0.0.1", "-p", h.port, "-N", "--configfile="+emptyConf(t))
	if err == nil && strings.Contains(out, "data") {
		t.Errorf("an anonymous client listed shares:\n%s", out)
	}
}

func TestRpcclientCalls(t *testing.T) {
	tool := needTool(t, "rpcclient")
	h := newHarness(t)
	sid := userSIDString(h.srv)

	cases := []struct {
		command string
		want    []string
	}{
		{"netshareenumall 1", []string{"netname: data", "remark:\tTest drive data"}},
		{"netsharegetinfo data 1", []string{"netname: data"}},
		{"lsaquery", []string{"Domain Name: ", "Domain Sid: "}},
		{"lookupsids S-1-1-0", []string{"Everyone"}},
		{"lookupsids " + sid, []string{`AROZTEST\` + testUserName}},
		{"lookupsids3 " + sid + " S-1-1-0", nil},
		{"dsroledominfo", []string{"Machine Role"}},
		{"wkssvc_wkstagetinfo", []string{}}, //Prints nothing when it works
	}
	for _, c := range cases {
		t.Run(c.command, func(t *testing.T) {
			out, err := runTool(t, tool, "127.0.0.1", "-p", h.port, "-A", authFile(t), "--configfile="+emptyConf(t), "--option=client min protocol=SMB3_11", "-c", c.command)
			if c.want == nil {
				return //Only that the server survives an unsupported call
			}
			if err != nil {
				t.Fatalf("%v\n%s", err, out)
			}
			for _, want := range c.want {
				if !strings.Contains(out, want) {
					t.Errorf("missing %q:\n%s", want, out)
				}
			}
		})
	}
}

// Wireshark's dissector is an independent reading of NDR, and the only one
// here for lsa_LookupSids2, which rpcclient has no command for.
func TestWiresharkDecodesRPCReplies(t *testing.T) {
	tshark := needTool(t, "tshark")
	dir := t.TempDir()
	h := newHarness(t, func(c *Config) { c.CaptureDir = dir })
	c := newRawClient(t, h)

	path := wire.EncodeUTF16(`\\\\host\\IPC$`)
	w := wire.NewWriter(8 + len(path))
	w.U16(9)
	w.U16(0)
	w.U16(wire.HeaderSize + 8)
	w.U16(uint16(len(path)))
	w.Bytes(path)
	r := c.call(wire.CmdTreeConnect, w.B)
	if r.hdr.Status != 0 {
		t.Fatalf("tree connect: %x", r.hdr.Status)
	}
	c.tree = r.hdr.TreeID
	pipe := mustCreate(t, c, "lsarpc", createOpts{access: wire.FileReadData | wire.FileWriteData, share: shareAll, disposition: wire.DispositionOpen})

	transact := func(pdu []byte) []byte {
		t.Helper()
		if r := c.call(wire.CmdWrite, writeBodyOf(pipe, 0, pdu)); r.hdr.Status != 0 {
			t.Fatalf("pipe write: %x", r.hdr.Status)
		}
		r := c.call(wire.CmdRead, readBodyOf(pipe, 0, 4280))
		if r.hdr.Status != 0 {
			t.Fatalf("pipe read: %x", r.hdr.Status)
		}
		return r.body[16:]
	}

	ndr32 := []byte{0x04, 0x5d, 0x88, 0x8a, 0xeb, 0x1c, 0xc9, 0x11, 0x9f, 0xe8, 0x08, 0x00, 0x2b, 0x10, 0x48, 0x60}
	lsa := []byte{0x78, 0x57, 0x34, 0x12, 0x34, 0x12, 0xcd, 0xab, 0xef, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab}
	ds := []byte{0x6a, 0x28, 0x19, 0x39, 0x0c, 0xb1, 0xd0, 0x11, 0x9b, 0xa8, 0x00, 0xc0, 0x4f, 0xd9, 0x2e, 0xf5}
	rpcHeader := func(ptype byte, callID uint32, body []byte) []byte {
		p := wire.NewWriter(16 + len(body))
		p.Bytes([]byte{5, 0, ptype, 3, 0x10, 0, 0, 0})
		p.U16(uint16(16 + len(body)))
		p.U16(0)
		p.U32(callID)
		p.Bytes(body)
		return p.B
	}
	bind := func(ptype byte, callID uint32, ctx uint16, iface []byte) []byte {
		b := wire.NewWriter(72)
		b.U16(4280)
		b.U16(4280)
		b.U32(0)
		b.U8(1)
		b.Zero(3)
		b.U16(ctx)
		b.U8(1)
		b.U8(0)
		b.Bytes(iface)
		b.U32(0)
		b.Bytes(ndr32)
		b.U32(2)
		return rpcHeader(ptype, callID, b.B)
	}
	request := func(callID uint32, ctx, opnum uint16, stub []byte) []byte {
		b := wire.NewWriter(8 + len(stub))
		b.U32(uint32(len(stub)))
		b.U16(ctx)
		b.U16(opnum)
		b.Bytes(stub)
		return transact(rpcHeader(0, callID, b.B))
	}

	transact(bind(11, 1, 0, lsa))
	reply := request(2, 0, 44, make([]byte, 60))
	handle := append([]byte{}, reply[24:44]...)

	//lsa_LookupSids2 for the user and Everyone
	sids := []wire.SID{wire.UserSID(h.srv.machineSID, testUserName), wire.SIDEveryone}
	s := wire.NewWriter(128)
	s.Bytes(handle)
	s.U32(2)
	s.U32(0x20000)
	s.U32(2)
	s.U32(0x20004)
	s.U32(0x20008)
	for _, sid := range sids {
		s.U32(uint32(len(sid.SubAuth)))
		s.Bytes(sid.Bytes())
	}
	s.U32(0)
	s.U32(0)
	s.U16(1)
	s.Zero(2)
	s.U32(0)
	s.U32(0)
	s.U32(2)
	request(3, 0, 57, s.B)

	//lsa_QueryInfoPolicy, level 5, as Windows asks
	q := wire.NewWriter(24)
	q.Bytes(handle)
	q.U16(5)
	request(4, 0, 7, q.B)

	//lsa_OpenPolicy3
	request(5, 0, 130, make([]byte, 80))

	//DsRoleGetPrimaryDomainInformation
	transact(bind(14, 6, 1, ds))
	request(7, 1, 0, []byte{1, 0})

	c.close(pipe)
	c.nc.Close()
	h.srv.Close()

	pcaps, _ := filepath.Glob(filepath.Join(dir, "*.pcap"))
	if len(pcaps) != 1 {
		t.Fatalf("captures: %v", pcaps)
	}
	out, err := runTool(t, tshark, "-r", pcaps[0], "-2", "-Y", "dcerpc.pkt_type==2", "-V")
	if err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	for _, want := range []string{
		"lsa_LookupSids2", "String: " + testUserName, "String: Everyone", "lsa_QueryInfoPolicy", "lsa_OpenPolicy3",
		"DsRoleGetPrimaryDomainInformation", "Domain: WORKGROUP",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("Wireshark did not find %q", want)
		}
	}
	for _, bad := range []string{"Malformed", "Expert Info (Error", "[Dissector bug"} {
		if strings.Contains(out, bad) {
			t.Errorf("Wireshark reports %q:\n%s", bad, out)
		}
	}
}
