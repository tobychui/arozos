package appproxy

import (
	"encoding/json"
	"strings"
)

/*
	shim.go

	The rewrite script injected into path mode apps that have "Rewrite root
	paths" enabled. It runs before any script of the app and routes URLs the
	app builds at runtime (fetch, XHR, WebSocket, EventSource, history, DOM
	attributes, workers, service workers) under /app/<slug>/.

	It is served as a same-origin file (not inline) so a Content-Security-Policy
	that only allows 'self' scripts still lets it run.
*/

// shimPath is the reserved path (under the endpoint prefix) serving the script
const shimPath = "/__appproxy/shim.js"

const shimTemplate = `(function(){
"use strict";
var P = __PREFIX__;
if (window.__aroz_appproxy__) { return; }
window.__aroz_appproxy__ = P;
var ORIGIN = location.origin;
var HOST = location.host;

function under(p){
	return p === P || p.indexOf(P + "/") === 0 || p.indexOf(P + "?") === 0 || p.indexOf(P + "#") === 0;
}
function fix(u){
	if (u == null) { return u; }
	if (typeof u !== "string") {
		if (typeof URL !== "undefined" && u instanceof URL) { return new URL(fix(u.href)); }
		return u;
	}
	var s = u.trim();
	if (s.charAt(0) === "/" && s.charAt(1) !== "/") {
		return under(s) ? u : P + s;
	}
	var m = /^(https?:|wss?:)?\/\/([^\/?#]+)(.*)$/i.exec(s);
	if (m && m[2].toLowerCase() === HOST.toLowerCase()) {
		var rest = m[3] || "/";
		if (rest.charAt(0) !== "/") { rest = "/" + rest; }
		if (!under(rest)) { rest = P + rest; }
		return (m[1] ? m[1] + "//" : "//") + m[2] + rest;
	}
	return u;
}
window.__aroz_fix_url__ = fix;

var _fetch = window.fetch;
if (_fetch) {
	window.fetch = function(input, init){
		try {
			if (typeof Request !== "undefined" && input instanceof Request) {
				var fixed = fix(input.url);
				if (fixed !== input.url) { input = new Request(fixed, input); }
			} else {
				input = fix(input);
			}
		} catch (e) {}
		return _fetch.call(this, input, init);
	};
}

var _open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url){
	var args = Array.prototype.slice.call(arguments);
	args[1] = fix(url);
	return _open.apply(this, args);
};

function wrapCtor(name){
	var Orig = window[name];
	if (!Orig) { return; }
	var Wrapped = function(url, opt){
		return opt === undefined ? new Orig(fix(url)) : new Orig(fix(url), opt);
	};
	Wrapped.prototype = Orig.prototype;
	for (var k in Orig) { try { Wrapped[k] = Orig[k]; } catch (e) {} }
	["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function(c){
		if (c in Orig) { try { Object.defineProperty(Wrapped, c, {value: Orig[c]}); } catch (e) {} }
	});
	window[name] = Wrapped;
}
wrapCtor("WebSocket");
wrapCtor("EventSource");
wrapCtor("Worker");
wrapCtor("SharedWorker");

["pushState", "replaceState"].forEach(function(fn){
	var orig = history[fn];
	history[fn] = function(state, title, url){
		if (url !== undefined && url !== null) { url = fix(String(url)); }
		return orig.call(this, state, title, url);
	};
});

var _wopen = window.open;
window.open = function(url){
	var args = Array.prototype.slice.call(arguments);
	if (typeof url === "string") { args[0] = fix(url); }
	return _wopen.apply(this, args);
};
try {
	var _assign = Location.prototype.assign, _replace = Location.prototype.replace;
	Location.prototype.assign = function(u){ return _assign.call(this, fix(String(u))); };
	Location.prototype.replace = function(u){ return _replace.call(this, fix(String(u))); };
} catch (e) {}

if (navigator.sendBeacon) {
	var _beacon = navigator.sendBeacon;
	navigator.sendBeacon = function(url, data){ return _beacon.call(navigator, fix(url), data); };
}

if (navigator.serviceWorker && navigator.serviceWorker.register) {
	var _register = navigator.serviceWorker.register;
	navigator.serviceWorker.register = function(url, opt){
		if (opt && typeof opt.scope === "string") { opt.scope = fix(opt.scope); }
		return _register.call(navigator.serviceWorker, fix(url), opt);
	};
}

var URL_ATTRS = {href: 1, src: 1, action: 1, formaction: 1, poster: 1, data: 1};
var _setAttr = Element.prototype.setAttribute;
Element.prototype.setAttribute = function(name, value){
	var n = String(name).toLowerCase();
	if (URL_ATTRS[n] && typeof value === "string") { value = fix(value); }
	return _setAttr.call(this, name, value);
};

function hookProp(ctor, prop){
	if (!ctor || !ctor.prototype) { return; }
	var d = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
	if (!d || !d.set || !d.configurable) { return; }
	Object.defineProperty(ctor.prototype, prop, {
		configurable: true,
		enumerable: d.enumerable,
		get: d.get,
		set: function(v){ return d.set.call(this, typeof v === "string" ? fix(v) : v); }
	});
}
hookProp(window.HTMLAnchorElement, "href");
hookProp(window.HTMLAreaElement, "href");
hookProp(window.HTMLLinkElement, "href");
hookProp(window.HTMLBaseElement, "href");
hookProp(window.HTMLImageElement, "src");
hookProp(window.HTMLScriptElement, "src");
hookProp(window.HTMLIFrameElement, "src");
hookProp(window.HTMLMediaElement, "src");
hookProp(window.HTMLSourceElement, "src");
hookProp(window.HTMLTrackElement, "src");
hookProp(window.HTMLEmbedElement, "src");
hookProp(window.HTMLInputElement, "src");
hookProp(window.HTMLFormElement, "action");
hookProp(window.HTMLVideoElement, "poster");
hookProp(window.HTMLObjectElement, "data");

//Markup inserted through innerHTML does not go through the setters above
function fixNode(el){
	if (!el || el.nodeType !== 1) { return; }
	for (var a in URL_ATTRS) {
		if (el.hasAttribute && el.hasAttribute(a)) {
			var v = el.getAttribute(a), f = fix(v);
			if (f !== v) { _setAttr.call(el, a, f); }
		}
	}
}
if (window.MutationObserver) {
	new MutationObserver(function(records){
		records.forEach(function(r){
			for (var i = 0; i < r.addedNodes.length; i++) {
				var n = r.addedNodes[i];
				if (n.nodeType !== 1) { continue; }
				fixNode(n);
				if (n.querySelectorAll) {
					var list = n.querySelectorAll("[href],[src],[action],[formaction],[poster],[data]");
					for (var j = 0; j < list.length; j++) { fixNode(list[j]); }
				}
			}
		});
	}).observe(document.documentElement, {childList: true, subtree: true});
}
})();
`

// renderShim returns the rewrite script for one endpoint prefix
func renderShim(prefix string) []byte {
	encoded, _ := json.Marshal(prefix)
	return []byte(strings.Replace(shimTemplate, "__PREFIX__", string(encoded), 1))
}
