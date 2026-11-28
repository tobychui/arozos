package metadata

import (
	"strconv"
	"sync"

	"github.com/shirou/gopsutil/v4/mem"
)

/*
	Image size limits

	Decoding a photo costs far more memory than its file size, so each image
	renderer refuses files above a limit to protect small hosts. A host with
	more than 4 GB of memory converts them anyway.
*/

// Hosts with more physical memory than this ignore the image size limits
const largeImageMemoryThreshold = 4 << 30

// Physical memory of this host in bytes, 0 if unknown
var totalSystemMemory = sync.OnceValue(func() uint64 {
	vm, err := mem.VirtualMemory()
	if err != nil {
		return 0
	}
	return vm.Total
})

// Only one oversized image is decoded at a time: a browser asks for many
// thumbnails at once and decoding them all together could use up the memory.
var largeImageLock sync.Mutex

// canConvertOversized reports whether a host of this memory size, running a
// build with this pointer width, may decode images above the size limits.
// 32 bit builds may not, their address space runs out whatever the host has.
func canConvertOversized(totalMemory uint64, intSize int) bool {
	return intSize == 64 && totalMemory > largeImageMemoryThreshold
}

// admitImageSize decides whether an image file of this size may be decoded.
// When ok, the caller must call release once it is done with the image.
func admitImageSize(size int64, limit int64) (release func(), ok bool) {
	if size <= limit {
		return func() {}, true
	}
	if !canConvertOversized(totalSystemMemory(), strconv.IntSize) {
		return nil, false
	}
	largeImageLock.Lock()
	return largeImageLock.Unlock, true
}
