package dynamicproxy

import (
	"fmt"
	"net/url"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/reverseproxy"
)

/*
	Add an URL intoa custom subdomain service

*/

func (router *Router) AddSubdomainRoutingService(hostnameWithSubdomain string, domain string, requireTLS bool) (out0 error) {
	defer logger.Out1(logger.In4("network/dynamicproxy", "Router.AddSubdomainRoutingService", "router", router, "hostnameWithSubdomain", hostnameWithSubdomain, "domain", domain, "requireTLS", requireTLS), &out0)
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

	proxy := reverseproxy.NewReverseProxy(path)

	router.SubdomainEndpoint.Store(hostnameWithSubdomain, &SubdomainEndpoint{
		MatchingDomain: hostnameWithSubdomain,
		Domain:         domain,
		RequireTLS:     requireTLS,
		Proxy:          proxy,
	})

	logger.PrintAndLog("Dynamicproxy", fmt.Sprint("Adding Subdomain Rule: ", hostnameWithSubdomain+" to "+domain), nil)
	return nil
}
