package main

import (
	"github.com/valyala/fasttemplate"
	"io/ioutil"
)

/*
	Web Template Generator

	This is the main system core module that perform function similar to what PHP did.
	To replace part of the content of any file, use {{paramter}} to replace it.

	
*/

func template_load(filename string, replacement map[string]interface{}) (string, error){
	content, err := ioutil.ReadFile(filename)
	if (err != nil){
		return "", nil
	}
	t := fasttemplate.New(string(content), "{{", "}}")
	s := t.ExecuteString(replacement)
	return string(s), nil
}

/*
	Custom tempalte loaders

	Please add your page custom template in the space below
*/

