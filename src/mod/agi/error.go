package agi

import (
	"html/template"
	"net/http"
	"os"
	"strconv"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Error Template Rendering for AGI script error

	This script is used to handle a PHP-like error message for the user
	For any runtime error, please see the console for more information.
*/

func (g *Gateway) RenderErrorTemplate(w http.ResponseWriter, errmsg string, scriptpath string) {
	if logger.IsDebug() {
		logger.Debugf("agi", "Gateway.RenderErrorTemplate: errmsg=%.120q scriptpath=%.120q", errmsg, scriptpath)
	}
	templateFile, err := os.ReadFile("system/agi/error.html")
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Define a template
	tmpl, err := template.New("errorTemplate").Parse(string(templateFile))
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Define data to be used in the template
	data := map[string]interface{}{
		"error_msg":       errmsg,
		"script_filepath": scriptpath,
		"timestamp":       strconv.Itoa(int(time.Now().Unix())),
		"major_version":   g.Option.BuildVersion,
		"minor_version":   g.Option.InternalVersion,
		"agi_version":     AgiVersion,
	}

	// Set status before writing the body so the header is actually sent as 500
	w.WriteHeader(http.StatusInternalServerError)

	// Execute the template
	err = tmpl.Execute(w, data)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
}
