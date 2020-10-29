package agi

import (
	"net/http"
	"io/ioutil"
	"strconv"
	"time"

	"github.com/valyala/fasttemplate"
)

/*
	Error Template Rendering for AGI script error

	This script is used to handle a PHP-like error message for the user
	For any runtime error, please see the console for more information.
*/


func (g *Gateway)RenderErrorTemplate(w http.ResponseWriter, errmsg string, scriptpath string){
	template, _ := ioutil.ReadFile("system/agi/error.html")
	t := fasttemplate.New(string(template), "{{", "}}")
	s := t.ExecuteString(map[string]interface{}{
		"error_msg":  errmsg,
		"script_filepath":  scriptpath,
		"timestamp":  strconv.Itoa(int(time.Now().Unix())),
		"major_version":  g.Option.BuildVersion,
		"minor_version":  g.Option.InternalVersion,
		"agi_version":  AgiVersion,
	})
	w.WriteHeader(http.StatusInternalServerError)
	w.Write([]byte(s))
}

