package agi

import (
	"html/template"
	"net/http"
	"os"
	"strconv"
	"time"
)

/*
	Error Template Rendering for AGI script error

	This script is used to handle a PHP-like error message for the user
	For any runtime error, please see the console for more information.
*/

func (g *Gateway) RenderErrorTemplate(w http.ResponseWriter, errmsg string, scriptpath string) {
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

	// Execute the template
	err = tmpl.Execute(w, data)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	// Set the HTTP status code
	w.WriteHeader(http.StatusInternalServerError)
}
