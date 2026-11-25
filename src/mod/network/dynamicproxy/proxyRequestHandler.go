package dynamicproxy

import (
	"net/http"
	"net/url"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/websocketproxy"
)

func (router *Router) getTargetProxyEndpointFromRequestURI(requestURI string) (out0 *ProxyEndpoint) {
	defer logger.Out1(logger.In2("network/dynamicproxy", "Router.getTargetProxyEndpointFromRequestURI", "router", router, "requestURI", requestURI), &out0)
	var targetProxyEndpoint *ProxyEndpoint = nil
	router.ProxyEndpoints.Range(func(key, value interface{}) bool {
		rootname := key.(string)
		if len(requestURI) >= len(rootname) && requestURI[:len(rootname)] == rootname {
			thisProxyEndpoint := value.(*ProxyEndpoint)
			targetProxyEndpoint = thisProxyEndpoint
		}
		return true
	})

	return targetProxyEndpoint
}

func (router *Router) getSubdomainProxyEndpointFromHostname(hostname string) (out0 *SubdomainEndpoint) {
	defer logger.Out1(logger.In2("network/dynamicproxy", "Router.getSubdomainProxyEndpointFromHostname", "router", router, "hostname", hostname), &out0)
	var targetSubdomainEndpoint *SubdomainEndpoint = nil
	ep, ok := router.SubdomainEndpoint.Load(hostname)
	if ok {
		targetSubdomainEndpoint = ep.(*SubdomainEndpoint)
	}

	return targetSubdomainEndpoint
}

func (router *Router) rewriteURL(rooturl string, requestURL string) (out0 string) {
	defer logger.Out1(logger.In3("network/dynamicproxy", "Router.rewriteURL", "router", router, "rooturl", rooturl, "requestURL", requestURL), &out0)
	if len(requestURL) > len(rooturl) {
		return requestURL[len(rooturl):]
	}
	return ""
}

func (h *ProxyHandler) subdomainRequest(w http.ResponseWriter, r *http.Request, target *SubdomainEndpoint) {
	defer logger.Out0(logger.In3("network/dynamicproxy", "ProxyHandler.subdomainRequest", "h", h, "r", r, "target", target))
	r.Header.Set("X-Forwarded-Host", r.Host)
	requestURL := r.URL.String()
	if r.Header["Upgrade"] != nil && r.Header["Upgrade"][0] == "websocket" {
		//Handle WebSocket request. Forward the custom Upgrade header and rewrite origin
		r.Header.Set("A-Upgrade", "websocket")
		wsRedirectionEndpoint := target.Domain
		if wsRedirectionEndpoint[len(wsRedirectionEndpoint)-1:] != "/" {
			//Append / to the end of the redirection endpoint if not exists
			wsRedirectionEndpoint = wsRedirectionEndpoint + "/"
		}
		if len(requestURL) > 0 && requestURL[:1] == "/" {
			//Remove starting / from request URL if exists
			requestURL = requestURL[1:]
		}
		u, _ := url.Parse("ws://" + wsRedirectionEndpoint + requestURL)
		if target.RequireTLS {
			u, _ = url.Parse("wss://" + wsRedirectionEndpoint + requestURL)
		}
		wspHandler := websocketproxy.NewProxy(u)
		wspHandler.ServeHTTP(w, r)
		return
	}

	r.Host = r.URL.Host
	err := target.Proxy.ServeHTTP(w, r)
	if err != nil {
		logger.DebugErr("network/dynamicproxy", err)
		logger.PrintAndLog("Dynamicproxy", err.Error(), nil)
	}

}

func (h *ProxyHandler) proxyRequest(w http.ResponseWriter, r *http.Request, target *ProxyEndpoint) {
	defer logger.Out0(logger.In3("network/dynamicproxy", "ProxyHandler.proxyRequest", "h", h, "r", r, "target", target))
	rewriteURL := h.Parent.rewriteURL(target.Root, r.RequestURI)
	r.URL, _ = url.Parse(rewriteURL)
	r.Header.Set("X-Forwarded-Host", r.Host)
	if r.Header["Upgrade"] != nil && r.Header["Upgrade"][0] == "websocket" {
		//Handle WebSocket request. Forward the custom Upgrade header and rewrite origin
		r.Header.Set("A-Upgrade", "websocket")
		wsRedirectionEndpoint := target.Domain
		if wsRedirectionEndpoint[len(wsRedirectionEndpoint)-1:] != "/" {
			wsRedirectionEndpoint = wsRedirectionEndpoint + "/"
		}
		u, _ := url.Parse("ws://" + wsRedirectionEndpoint + r.URL.String())
		if target.RequireTLS {
			u, _ = url.Parse("wss://" + wsRedirectionEndpoint + r.URL.String())
		}
		wspHandler := websocketproxy.NewProxy(u)
		wspHandler.ServeHTTP(w, r)
		return
	}

	r.Host = r.URL.Host
	err := target.Proxy.ServeHTTP(w, r)
	if err != nil {
		logger.DebugErr("network/dynamicproxy", err)
		logger.PrintAndLog("Dynamicproxy", err.Error(), nil)
	}
}
