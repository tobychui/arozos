package dynamicproxy

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/dynamicproxy/dpcore"
	"imuslab.com/arozos/mod/network/reverseproxy"
)

/*
Allow users to setup manual proxying for specific path
*/
type Router struct {
	ListenPort        int
	ProxyEndpoints    *sync.Map
	SubdomainEndpoint *sync.Map
	Running           bool
	Root              *ProxyEndpoint
	mux               http.Handler
	useTLS            bool
	server            *http.Server
}

type RouterOption struct {
	Port int
}

type ProxyEndpoint struct {
	Root       string
	Domain     string
	RequireTLS bool
	Proxy      *dpcore.ReverseProxy `json:"-"`
}

type SubdomainEndpoint struct {
	MatchingDomain string
	Domain         string
	RequireTLS     bool
	Proxy          *reverseproxy.ReverseProxy `json:"-"`
}

type ProxyHandler struct {
	Parent *Router
}

func NewDynamicProxy(port int) (out0 *Router, out1 error) {
	defer logger.Out2(logger.In1("network/dynamicproxy", "NewDynamicProxy", "port", port), &out0, &out1)
	proxyMap := sync.Map{}
	domainMap := sync.Map{}
	thisRouter := Router{
		ListenPort:        port,
		ProxyEndpoints:    &proxyMap,
		SubdomainEndpoint: &domainMap,
		Running:           false,
		useTLS:            false,
		server:            nil,
	}

	thisRouter.mux = &ProxyHandler{
		Parent: &thisRouter,
	}

	return &thisRouter, nil
}

// Start the dynamic routing
func (router *Router) StartProxyService() (out0 error) {
	defer logger.Out1(logger.In1("network/dynamicproxy", "Router.StartProxyService", "router", router), &out0)
	//Create a new server object
	if router.server != nil {
		return errors.New("Reverse proxy server already running")
	}

	if router.Root == nil {
		return errors.New("Reverse proxy router root not set")
	}

	router.server = &http.Server{Addr: ":" + strconv.Itoa(router.ListenPort), Handler: router.mux}
	router.Running = true
	go func() {
		err := router.server.ListenAndServe()
		logger.PrintAndLog("Dynamicproxy", "[DynamicProxy] "+err.Error(), nil)
	}()

	return nil
}

func (router *Router) StopProxyService() (out0 error) {
	defer logger.Out1(logger.In1("network/dynamicproxy", "Router.StopProxyService", "router", router), &out0)
	if router.server == nil {
		return errors.New("Reverse proxy server already stopped")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := router.server.Shutdown(ctx)
	if err != nil {
		logger.DebugErr("network/dynamicproxy", err)
		return err
	}

	//Discard the server object
	router.server = nil
	router.Running = false
	return nil
}

/*
Add an URL into a custom proxy services
*/
func (router *Router) AddProxyService(rootname string, domain string, requireTLS bool) (out0 error) {
	defer logger.Out1(logger.In4("network/dynamicproxy", "Router.AddProxyService", "router", router, "rootname", rootname, "domain", domain, "requireTLS", requireTLS), &out0)
	if domain[len(domain)-1:] == "/" {
		domain = domain[:len(domain)-1]
	}

	webProxyEndpoint := domain
	if requireTLS {
		webProxyEndpoint = "https://" + webProxyEndpoint
	} else {
		webProxyEndpoint = "http://" + webProxyEndpoint
	}
	//Create a new proxy agent for this root
	path, err := url.Parse(webProxyEndpoint)
	if err != nil {
		logger.DebugErr("network/dynamicproxy", err)
		return err
	}

	proxy := dpcore.NewDynamicProxyCore(path, rootname)

	router.ProxyEndpoints.Store(rootname, &ProxyEndpoint{
		Root:       rootname,
		Domain:     domain,
		RequireTLS: requireTLS,
		Proxy:      proxy,
	})

	logger.PrintAndLog("Dynamicproxy", fmt.Sprint("Adding Proxy Rule: ", rootname+" to "+domain), nil)
	return nil
}

/*
Add an default router for the proxy server
*/
func (router *Router) SetRootProxy(proxyLocation string, requireTLS bool) (out0 error) {
	defer logger.Out1(logger.In3("network/dynamicproxy", "Router.SetRootProxy", "router", router, "proxyLocation", proxyLocation, "requireTLS", requireTLS), &out0)
	if proxyLocation[len(proxyLocation)-1:] == "/" {
		proxyLocation = proxyLocation[:len(proxyLocation)-1]
	}

	webProxyEndpoint := proxyLocation
	if requireTLS {
		webProxyEndpoint = "https://" + webProxyEndpoint
	} else {
		webProxyEndpoint = "http://" + webProxyEndpoint
	}
	//Create a new proxy agent for this root
	path, err := url.Parse(webProxyEndpoint)
	if err != nil {
		logger.DebugErr("network/dynamicproxy", err)
		return err
	}

	proxy := dpcore.NewDynamicProxyCore(path, "")

	rootEndpoint := ProxyEndpoint{
		Root:       "/",
		Domain:     proxyLocation,
		RequireTLS: requireTLS,
		Proxy:      proxy,
	}

	router.Root = &rootEndpoint
	return nil
}

// Do all the main routing in here
func (h *ProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("network/dynamicproxy", "ProxyHandler.ServeHTTP", "h", h, "r", r))
	if strings.Contains(r.Host, ".") {
		//This might be a subdomain. See if there are any subdomain proxy router for this
		sep := h.Parent.getSubdomainProxyEndpointFromHostname(r.Host)
		if sep != nil {
			h.subdomainRequest(w, r, sep)
			return
		}
	}

	targetProxyEndpoint := h.Parent.getTargetProxyEndpointFromRequestURI(r.RequestURI)
	if targetProxyEndpoint != nil {
		h.proxyRequest(w, r, targetProxyEndpoint)
	} else {
		h.proxyRequest(w, r, h.Parent.Root)
	}
}
