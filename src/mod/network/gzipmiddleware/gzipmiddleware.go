package gzipmiddleware

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	This module handles web server related helpers and functions
	author: tobychui

*/

var gzPool = sync.Pool{
	New: func() interface{} {
		w := gzip.NewWriter(io.Discard)
		gzip.NewWriterLevel(w, gzip.BestCompression)
		return w
	},
}

type gzipResponseWriter struct {
	io.Writer
	http.ResponseWriter
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/gzipmiddleware", "gzipResponseWriter.WriteHeader: status=%d", status)
	}
	//w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/gzipmiddleware", "gzipResponseWriter.Write: len(b)=%d", len(b))
	}
	return w.Writer.Write(b)
}

/*
Compresstion function for http.FileServer
*/
func Compress(h http.Handler) http.Handler {
	logger.DebugTrace("network/gzipmiddleware", "Compress")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			//If the client do not support gzip
			h.ServeHTTP(w, r)
			return
		}

		//Handle very special case where it is /share/download
		if strings.HasPrefix(r.URL.RequestURI(), "/share/download/") {
			h.ServeHTTP(w, r)
			return
		}

		//Check if this is websocket request. Skip this if true
		if r.Header["Upgrade"] != nil && r.Header["Upgrade"][0] == "websocket" {
			//WebSocket request. Do not gzip it
			h.ServeHTTP(w, r)
			return
		}

		//Check if this is Safari. Skip gzip as Catalina Safari dont work with some gzip content
		// BETTER IMPLEMENTATION NEEDED
		if strings.Contains(r.Header.Get("User-Agent"), "Safari/") {
			//Always do not compress for Safari
			h.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Encoding", "gzip")

		gz := gzPool.Get().(*gzip.Writer)
		defer gzPool.Put(gz)

		gz.Reset(w)
		defer gz.Close()

		h.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, Writer: gz}, r)
	})
}

type gzipFuncResponseWriter struct {
	io.Writer
	http.ResponseWriter
}

func (w gzipFuncResponseWriter) Write(b []byte) (int, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/gzipmiddleware", "gzipFuncResponseWriter.Write: len(b)=%d", len(b))
	}
	return w.Writer.Write(b)
}

/*
Compress Function for http.HandleFunc
*/
func CompressFunc(fn http.HandlerFunc) http.HandlerFunc {
	logger.DebugTrace("network/gzipmiddleware", "CompressFunc")
	return func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			fn(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		gzr := gzipFuncResponseWriter{Writer: gz, ResponseWriter: w}
		fn(gzr, r)
	}
}
