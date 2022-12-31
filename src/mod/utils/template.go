package utils

import (
	"io/ioutil"
	"net/http"

	"github.com/valyala/fasttemplate"
)

/*
	Web Template Generator

	This is the main system core module that perform function similar to what PHP did.
	To replace part of the content of any file, use {{paramter}} to replace it.


*/

func Templateload(filename string, replacement map[string]interface{}) (string, error) {
	content, err := ioutil.ReadFile(filename)
	if err != nil {
		return "", nil
	}
	t := fasttemplate.New(string(content), "{{", "}}")
	s := t.ExecuteString(replacement)
	return string(s), nil
}

func TemplateApply(templateString string, replacement map[string]interface{}) string {
	t := fasttemplate.New(templateString, "{{", "}}")
	s := t.ExecuteString(replacement)
	return string(s)
}

func SendHTMLResponse(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(msg))
}
