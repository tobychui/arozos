package smbserver

import (
	"bytes"
	"crypto/md5"
	"fmt"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

func (c *conn) handleIoctl(r *request) *response {
	q, err := wire.ParseIoctl(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if q.Flags&wire.IoctlIsFsctl == 0 {
		return errorResponse(wire.StatusNotSupported)
	}
	size := uint64(len(q.Input))
	if uint64(q.MaxOutputResponse) > size {
		size = uint64(q.MaxOutputResponse)
	}
	if !r.checkCharge(size) {
		return errorResponse(wire.StatusInvalidParameter)
	}
	r.detail = fmt.Sprintf("ctl=0x%08x ", q.CtlCode)

	switch q.CtlCode {
	case wire.FsctlCreateOrGetObjectID, wire.FsctlGetObjectID:
		return c.objectID(r, q)
	case wire.FsctlDeleteObjectID:
		//The id is derived from the file, so there is nothing to delete
		return ioctlResponse(q, nil, wire.StatusOK)
	case wire.FsctlValidateNegotiateInfo:
		return c.validateNegotiate(q)
	case wire.FsctlPipeTransceive:
		return c.transceive(r, q)
	case wire.FsctlDfsGetReferrals, wire.FsctlDfsGetReferralsEx:
		//This server has no DFS namespace
		return errorResponse(wire.StatusNotFound)
	case wire.FsctlEnumerateSnapshots:
		return c.enumerateSnapshots(r, q)
	case wire.FsctlSrvRequestResumeKey:
		return c.requestResumeKey(r, q)
	case wire.FsctlSrvCopyChunk:
		return c.copyChunks(r, q, true)
	case wire.FsctlSrvCopyChunkWrite:
		return c.copyChunks(r, q, false)
	}
	return errorResponse(wire.StatusInvalidDeviceRequest)
}

// volumeObjectID identifies a share as a volume to link tracking.
func volumeObjectID(s Share) [16]byte {
	sum := md5.Sum([]byte("arozos-smb-volume\x00" + s.Key()))
	return sum
}

// objectID answers the link tracking Windows does for shortcuts and recent
// files. The id is worked out from the file instead of being stored.
func (c *conn) objectID(r *request, q *wire.IoctlRequest) *response {
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if o.pipe != nil {
		return errorResponse(wire.StatusInvalidDeviceRequest)
	}
	share := o.tree.share
	p := o.getPath()
	info, err := share.Stat(p)
	if err != nil {
		return errorResponse(statusOf(err))
	}
	volume := volumeObjectID(share)

	w := wire.NewWriter(64)
	id := wire.NewWriter(16)
	id.U64(fileNumber(share, p, info))
	id.U64(volumeSerial(share))
	w.Bytes(id.B)      //Object id
	w.Bytes(volume[:]) //Birth volume id
	w.Bytes(id.B)      //Birth object id
	w.Zero(16)         //Domain id
	if q.MaxOutputResponse < 64 {
		return errorResponse(wire.StatusBufferTooSmall)
	}
	return ioctlResponse(q, w.B, wire.StatusOK)
}

func ioctlResponse(q *wire.IoctlRequest, output []byte, status uint32) *response {
	const fixed = 48
	w := wire.NewWriter(fixed + len(output))
	w.U16(49)
	w.U16(0)
	w.U32(q.CtlCode)
	w.Bytes(q.FileID[:])
	w.U32(wire.HeaderSize + fixed)
	w.U32(0)
	w.U32(wire.HeaderSize + fixed)
	w.U32(uint32(len(output)))
	w.U32(0)
	w.U32(0)
	w.Bytes(output)
	return &response{status: status, body: w.B}
}

// validateNegotiate is the downgrade check of 3.0 and 3.0.2 clients: they send
// what they believe was negotiated over the now signed session, and a mismatch
// means someone rewrote the unsigned NEGOTIATE.
func (c *conn) validateNegotiate(q *wire.IoctlRequest) *response {
	in := wire.NewReader(q.Input)
	caps := in.U32()
	guid := in.Bytes(16)
	mode := in.U16()
	count := int(in.U16())
	offered := []uint16{}
	for i := 0; i < count && i < 64; i++ {
		offered = append(offered, in.U16())
	}

	c.mu.Lock()
	dialect := c.dialect
	serverCaps := c.serverCaps
	matches := !in.Bad() && caps == c.clientCaps && mode == c.clientMode && bytes.Equal(guid, c.clientGUID[:])
	c.mu.Unlock()
	if !matches || pickDialect(offered) != dialect {
		c.trace("validate negotiate failed, closing")
		c.shutdown()
		return errorResponse(wire.StatusAccessDenied)
	}

	w := wire.NewWriter(24)
	w.U32(serverCaps)
	w.Bytes(c.srv.cfg.GUID[:])
	w.U16(wire.SigningEnabled | wire.SigningRequired)
	w.U16(dialect)
	return ioctlResponse(q, w.B, wire.StatusOK)
}

func (c *conn) transceive(r *request, q *wire.IoctlRequest) *response {
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if o.pipe == nil {
		return errorResponse(wire.StatusInvalidDeviceRequest)
	}

	o.pipeMu.Lock()
	defer o.pipeMu.Unlock()
	if err := o.pipe.Write(q.Input); err != nil {
		c.trace("pipe %s: %v", o.pipeName, err)
		return errorResponse(wire.StatusPipeDisconnected)
	}
	output, more := o.pipe.Read(int(q.MaxOutputResponse))
	status = wire.StatusOK
	if more {
		status = wire.StatusBufferOverflow
	}
	return ioctlResponse(q, output, status)
}
