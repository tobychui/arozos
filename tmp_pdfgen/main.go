package main

import (
	"fmt"
	"os"
	"strings"

	"imuslab.com/arozos/mod/office"
)

func main() {
	lorem := "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque porta magna turpis, quis malesuada velit viverra eget. Praesent nunc arcu, porttitor eu placerat quis, cursus quis quam. Phasellus a orci sit amet nisi molestie scelerisque. Aenean imperdiet ex tincidunt facilisis molestie."
	// variant with nbsp between many words (contenteditable artifact)
	nb := strings.ReplaceAll(lorem, " ", " ")
	doc := &office.Document{HTML: "<p>" + lorem + "</p><p>" + nb + "</p>"}
	data, err := office.BuildDocPdf(doc)
	if err != nil {
		panic(err)
	}
	os.WriteFile(os.Args[1], data, 0644)
	fmt.Println("ok")
}
