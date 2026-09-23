//go:build !(js && wasm)

/*
Placeholder main for every target that is not js/wasm.

Without it this package would have no buildable files off js/wasm and
`go build ./...` / `go vet ./...` / `go test ./...` would fail with
"build constraints exclude all Go files" on every normal ArozOS build.
convert.go carries the actual conversion table and is compiled (and
tested) everywhere; only the syscall/js bridge in main.go is constrained.
*/
package main

import "fmt"

func main() {
	in, out := ConverterNames()
	fmt.Println("ArozOS Office WebAssembly bridge")
	fmt.Println("This package is only useful as a WebAssembly module. Build it with:")
	fmt.Println("    cd src && GOOS=js GOARCH=wasm go build -o office.wasm ./wasm/office")
	fmt.Println("or let the web-viewer generator do it:")
	fmt.Println("    cd \"apps/ArozOS Office Web\" && ./update_viewer.sh -wasm")
	fmt.Printf("Converters compiled in: %d import, %d export\n", len(in), len(out))
}
