package main

import (
	"encoding/json"
	"log"
	"net/http"

	module "imuslab.com/arozos/mod/modules"
	"imuslab.com/arozos/mod/network/dynamicproxy"
	prout "imuslab.com/arozos/mod/prouter"
)

var (
	dynamicProxyRouter *dynamicproxy.Router
)

//Add user customizable reverse proxy
func ReverseProxtInit() {

	return
	dprouter, err := dynamicproxy.NewDynamicProxy(80)
	if err != nil {
		log.Println(err.Error())
		return
	}

	dynamicProxyRouter = dprouter

	//Register the module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Reverse Proxy",
		Desc:        "Setup reverse proxy to other nearby services",
		Group:       "System Settings",
		IconPath:    "SystemAO/reverse_proxy/img/small_icon.png",
		Version:     "1.0",
		StartDir:    "SystemAO/reverse_proxy/index.html",
		SupportFW:   true,
		InitFWSize:  []int{1080, 580},
		LaunchFWDir: "SystemAO/reverse_proxy/index.html",
		SupportEmb:  false,
	})

	//Register HybridBackup storage restore endpoints
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Reverse Proxy",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	router.HandleFunc("/system/proxy/enable", ReverseProxyHandleOnOff)
	router.HandleFunc("/system/proxy/add", ReverseProxyHandleAddEndpoint)
	router.HandleFunc("/system/proxy/status", ReverseProxyStatus)
	router.HandleFunc("/system/proxy/list", ReverseProxyList)

	/*
		dynamicProxyRouter.SetRootProxy("192.168.0.107:8080", false)
		dynamicProxyRouter.AddSubdomainRoutingService("loopback.localhost", "localhost:8080", false)
		dynamicProxyRouter.StartProxyService()
		go func() {
			time.Sleep(10 * time.Second)
			dynamicProxyRouter.StopProxyService()
			fmt.Println("Proxy stopped")
		}()
		log.Println("Dynamic Proxy service started")
	*/
}

func ReverseProxyHandleOnOff(w http.ResponseWriter, r *http.Request) {
	enable, _ := mv(r, "enable", true) //Support root, vdir and subd
	if enable == "true" {
		err := dynamicProxyRouter.StartProxyService()
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
	} else {
		err := dynamicProxyRouter.StopProxyService()
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
	}

	sendOK(w)
}

func ReverseProxyHandleAddEndpoint(w http.ResponseWriter, r *http.Request) {
	eptype, err := mv(r, "type", true) //Support root, vdir and subd
	if err != nil {
		sendErrorResponse(w, "type not defined")
		return
	}

	endpoint, err := mv(r, "ep", true)
	if err != nil {
		sendErrorResponse(w, "endpoint not defined")
		return
	}

	tls, _ := mv(r, "tls", true)
	if tls == "" {
		tls = "false"
	}

	useTLS := (tls == "true")

	if eptype == "vdir" {
		vdir, err := mv(r, "vdir", true)
		if err != nil {
			sendErrorResponse(w, "vdir not defined")
			return
		}
		dynamicProxyRouter.AddProxyService(vdir, endpoint, useTLS)

	} else if eptype == "subd" {
		subdomain, err := mv(r, "subdomain", true)
		if err != nil {
			sendErrorResponse(w, "subdomain not defined")
			return
		}
		dynamicProxyRouter.AddSubdomainRoutingService(subdomain, endpoint, useTLS)
	} else if eptype == "root" {
		dynamicProxyRouter.SetRootProxy(endpoint, useTLS)
	}

	sendOK(w)

}

func ReverseProxyStatus(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(dynamicProxyRouter)
	sendJSONResponse(w, string(js))
}

func ReverseProxyList(w http.ResponseWriter, r *http.Request) {
	eptype, err := mv(r, "type", true) //Support root, vdir and subd
	if err != nil {
		sendErrorResponse(w, "type not defined")
		return
	}

	if eptype == "vdir" {
		results := []*dynamicproxy.ProxyEndpoint{}
		dynamicProxyRouter.ProxyEndpoints.Range(func(key, value interface{}) bool {
			results = append(results, value.(*dynamicproxy.ProxyEndpoint))
			return true
		})

		js, _ := json.Marshal(results)
		sendJSONResponse(w, string(js))
	} else if eptype == "subd" {
		results := []*dynamicproxy.SubdomainEndpoint{}
		dynamicProxyRouter.SubdomainEndpoint.Range(func(key, value interface{}) bool {
			results = append(results, value.(*dynamicproxy.SubdomainEndpoint))
			return true
		})
		js, _ := json.Marshal(results)
		sendJSONResponse(w, string(js))
	} else {
		sendErrorResponse(w, "Invalid type given")
	}
}
