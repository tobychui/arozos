package setupwizard

import (
	"strings"
	"testing"
)

// A Raspberry Pi with an SD card, a few USB disks and an NVMe drive, as
// `lsblk -b -J -o NAME,TYPE,SIZE,FSTYPE,UUID,LABEL,MOUNTPOINT,MODEL,RM` prints it
const sampleLsblk = `{
 "blockdevices": [
  {"name":"zram0","type":"disk","size":4294967296,"fstype":null,"uuid":null,"label":null,"mountpoint":"[SWAP]","model":null,"rm":false},
  {"name":"mmcblk0","type":"disk","size":63864569856,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":null,"rm":false,
   "children":[
    {"name":"mmcblk0p1","type":"part","size":536870912,"fstype":"vfat","uuid":"4EF5-6F55","label":"bootfs","mountpoint":"/boot/firmware","model":null,"rm":false},
    {"name":"mmcblk0p2","type":"part","size":63322521600,"fstype":"ext4","uuid":"ce208fd3","label":"rootfs","mountpoint":"/","model":null,"rm":false},
    {"name":"mmcblk0p3","type":"part","size":1048576,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":null,"rm":false}
   ]},
  {"name":"mmcblk0boot0","type":"disk","size":4194304,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":null,"rm":false},
  {"name":"sda","type":"disk","size":1000204886016,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"Portable SSD ","rm":true,
   "children":[
    {"name":"sda1","type":"part","size":1000202788864,"fstype":"ntfs","uuid":"0A1B2C3D","label":"Backup","mountpoint":null,"model":null,"rm":true}
   ]},
  {"name":"sdb","type":"disk","size":2000398934016,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"WD20EFRX","rm":false},
  {"name":"sdc","type":"disk","size":500107862016,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"Old Disk","rm":false,
   "children":[
    {"name":"sdc1","type":"part","size":500105740288,"fstype":"ext4","uuid":"aaaa-1111","label":"data","mountpoint":"/mnt/data","model":null,"rm":false},
    {"name":"sdc2","type":"part","size":1048576,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":null,"rm":false}
   ]},
  {"name":"sdd","type":"disk","size":4000787030016,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"RAID member","rm":false,
   "children":[
    {"name":"sdd1","type":"part","size":4000785104896,"fstype":"linux_raid_member","uuid":"r1","label":"pi:0","mountpoint":null,"model":null,"rm":false,
     "children":[{"name":"md0","type":"raid1","size":4000650887168,"fstype":"ext4","uuid":"md-uuid","label":null,"mountpoint":"/media/raid","model":null,"rm":false}]}
   ]},
  {"name":"sde","type":"disk","size":250059350016,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"Drive disk","rm":false,
   "children":[
    {"name":"sde1","type":"part","size":250057252864,"fstype":"ext4","uuid":"bbbb-2222","label":"photos","mountpoint":"/media/photos","model":null,"rm":false}
   ]},
  {"name":"sdf","type":"disk","size":"128043712512","fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"Old lsblk","rm":"1",
   "children":[
    {"name":"sdf1","type":"part","size":"128041615360","fstype":"exfat","uuid":"EX-01","label":"CAMERA","mountpoint":null,"model":null,"rm":"1"}
   ]},
  {"name":"sdg","type":"disk","size":0,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"Card reader","rm":true},
  {"name":"nvme0n1","type":"disk","size":512110190592,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"NVMe","rm":false,
   "children":[
    {"name":"nvme0n1p1","type":"part","size":512109142016,"fstype":"LVM2_member","uuid":"lvm-1","label":null,"mountpoint":null,"model":null,"rm":false,
     "children":[{"name":"vg-data","type":"lvm","size":512105000000,"fstype":"xfs","uuid":"x","label":null,"mountpoint":"/srv/data","model":null,"rm":false}]}
   ]},
  {"name":"sr0","type":"rom","size":1073741312,"fstype":null,"uuid":null,"label":null,"mountpoint":null,"model":"DVD","rm":true}
 ]
}`

var sampleDrives = []UsedDrive{
	{ID: "photos", Mountdev: "/dev/sde1", DiskUUID: "bbbb-2222", Path: "/media/photos"},
	{ID: "rootfolder", Path: "/data/files"}, //a folder on the root disk must not mark the root disk as a drive
}

func parseSample(t *testing.T) []Disk {
	t.Helper()
	disks, err := ParseDisks([]byte(sampleLsblk), sampleDrives)
	if err != nil {
		t.Fatalf("ParseDisks: %v", err)
	}
	return disks
}

func TestParseDisksList(t *testing.T) {
	disks := parseSample(t)
	names := []string{}
	for _, d := range disks {
		names = append(names, d.Name)
	}
	//zram, eMMC boot areas, empty card readers and optical drives are not storage
	if got, want := strings.Join(names, ","), "mmcblk0,sda,sdb,sdc,sdd,sde,sdf,nvme0n1"; got != want {
		t.Fatalf("disks = %s, want %s", got, want)
	}
}

func TestParseDisksUse(t *testing.T) {
	disks := parseSample(t)
	tests := []struct {
		device    string
		diskUse   string
		partUse   string
		canFormat bool
		canAdd    bool
		addMode   string
		driveID   string
	}{
		{device: "/dev/mmcblk0p1", diskUse: UseSystem, partUse: UseSystem},
		{device: "/dev/mmcblk0p2", diskUse: UseSystem, partUse: UseSystem},
		{device: "/dev/mmcblk0p3", diskUse: UseSystem, partUse: ""}, //free, but on the system disk
		{device: "/dev/sda1", canFormat: true, canAdd: true, addMode: AddMount},
		{device: "/dev/sdb", canFormat: true}, //blank disk: format first
		{device: "/dev/sdc1", diskUse: UseMounted, partUse: UseMounted, canAdd: true, addMode: AddFolder},
		{device: "/dev/sdc2", diskUse: UseMounted},
		{device: "/dev/sdd1", diskUse: UseRAID, partUse: UseRAID},
		{device: "/dev/sde1", diskUse: UseDrive, partUse: UseDrive, driveID: "photos"},
		{device: "/dev/sdf1", canFormat: true}, //exfat cannot be a drive
		{device: "/dev/nvme0n1p1", diskUse: UseLVM, partUse: UseLVM},
	}
	for _, tt := range tests {
		t.Run(tt.device, func(t *testing.T) {
			disk, part, err := FindPartition(disks, tt.device)
			if err != nil {
				t.Fatalf("FindPartition: %v", err)
			}
			if disk.InUse != tt.diskUse {
				t.Errorf("disk InUse = %q, want %q", disk.InUse, tt.diskUse)
			}
			if part.InUse != tt.partUse {
				t.Errorf("partition InUse = %q, want %q", part.InUse, tt.partUse)
			}
			if part.CanFormat != tt.canFormat {
				t.Errorf("CanFormat = %v, want %v", part.CanFormat, tt.canFormat)
			}
			if part.CanAdd != tt.canAdd || part.AddMode != tt.addMode {
				t.Errorf("CanAdd, AddMode = %v, %q, want %v, %q", part.CanAdd, part.AddMode, tt.canAdd, tt.addMode)
			}
			if part.DriveID != tt.driveID {
				t.Errorf("DriveID = %q, want %q", part.DriveID, tt.driveID)
			}
		})
	}
}

func TestParseDisksDetails(t *testing.T) {
	disks := parseSample(t)
	sdb, _, _ := FindPartition(disks, "/dev/sdb")
	if !sdb.Whole || len(sdb.Partitions) != 1 || sdb.Model != "WD20EFRX" {
		t.Errorf("blank disk = %+v, want one whole-disk entry", sdb)
	}
	sda, sda1, _ := FindPartition(disks, "/dev/sda1")
	if !sda.Removable || sda.Model != "Portable SSD" || sda1.Label != "Backup" || sda1.Fstype != "ntfs" {
		t.Errorf("sda = %+v / %+v", sda, sda1)
	}
	//Old lsblk prints numbers and booleans as strings
	sdf, sdf1, _ := FindPartition(disks, "/dev/sdf1")
	if sdf.Size != 128043712512 || !sdf.Removable || sdf1.Size != 128041615360 {
		t.Errorf("string numbers not read: disk %d removable %v part %d", sdf.Size, sdf.Removable, sdf1.Size)
	}

	if _, err := ParseDisks([]byte("not json"), nil); err == nil {
		t.Error("ParseDisks should fail on bad input")
	}
}

func TestCheckFormat(t *testing.T) {
	disks := parseSample(t)
	tests := []struct {
		device  string
		wantErr string
	}{
		{device: "/dev/sda1"},
		{device: "/dev/sdb"},
		{device: "/dev/mmcblk0p3", wantErr: "system"},
		{device: "/dev/sdc2", wantErr: "mounted"},
		{device: "/dev/sde1", wantErr: "drive"},
		{device: "/dev/sdd1", wantErr: "raid"},
		{device: "/dev/sdd", wantErr: "not found"}, //a disk with partitions is not formatted whole
		{device: "/dev/sdz1", wantErr: "not found"},
	}
	for _, tt := range tests {
		t.Run(tt.device, func(t *testing.T) {
			_, err := CheckFormat(disks, tt.device)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("CheckFormat(%s) unexpected error: %v", tt.device, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("CheckFormat(%s) error = %v, want %q", tt.device, err, tt.wantErr)
			}
		})
	}
}

func TestFormatCommand(t *testing.T) {
	tests := []struct {
		fstype  string
		label   string
		device  string
		want    string
		wantErr bool
	}{
		{fstype: "ext4", label: "Media", device: "/dev/sdb1", want: "mkfs.ext4 -F -L Media /dev/sdb1"},
		{fstype: "ext4", label: "", device: "/dev/sdb", want: "mkfs.ext4 -F /dev/sdb"},
		{fstype: "ntfs", label: "My Files", device: "/dev/sda1", want: "mkfs.ntfs -f -L My Files /dev/sda1"},
		{fstype: "vfat", label: "camera card!", device: "/dev/sdf1", want: "mkfs.vfat -n CAMERA CARD /dev/sdf1"},
		{fstype: "ext4", label: "x;rm -rf $HOME", device: "/dev/sdb1", want: "mkfs.ext4 -F -L xrm -rf HOME /dev/sdb1"},
		{fstype: "btrfs", device: "/dev/sdb1", wantErr: true},
		{fstype: "ext4", device: "sdb1", wantErr: true},
		{fstype: "ext4", device: "/dev/../etc/passwd", wantErr: true},
		{fstype: "ext4", device: "/dev/", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.fstype+" "+tt.device, func(t *testing.T) {
			bin, args, err := FormatCommand(tt.fstype, tt.label, tt.device)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %s %v", bin, args)
				}
				return
			}
			if err != nil {
				t.Fatalf("FormatCommand: %v", err)
			}
			if got := bin + " " + strings.Join(args, " "); got != tt.want {
				t.Errorf("command = %q, want %q", got, tt.want)
			}
			if args[len(args)-1] != tt.device {
				t.Errorf("the device must be the last argument, got %v", args)
			}
		})
	}
}

func TestCleanLabel(t *testing.T) {
	tests := []struct {
		fstype, label, want string
	}{
		{"vfat", "abcdefghijklmnop", "ABCDEFGHIJK"},
		{"ext4", "a very long label name", "a very long labe"},
		{"ntfs", "  spaced  ", "spaced"},
		{"ext4", "../..", ""},
	}
	for _, tt := range tests {
		if got := CleanLabel(tt.fstype, tt.label); got != tt.want {
			t.Errorf("CleanLabel(%q, %q) = %q, want %q", tt.fstype, tt.label, got, tt.want)
		}
	}
}

func TestValidDriveID(t *testing.T) {
	tests := []struct {
		id   string
		want bool
	}{
		{"media", true},
		{"usb_disk-1", true},
		{"", false},
		{"../etc", false},
		{"a/b", false},
		{"has space", false},
		{strings.Repeat("a", 65), false},
	}
	for _, tt := range tests {
		if got := ValidDriveID(tt.id); got != tt.want {
			t.Errorf("ValidDriveID(%q) = %v, want %v", tt.id, got, tt.want)
		}
	}
}
