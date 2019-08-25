//FloatWindow.js
//ArOZ Online Beta Project 
//This function is developed for launching a FloatWindow in Function Bar environment
//[Variables Meaning]
//src: The path in which the new window points to
//title: The title text that displace on the window top bar
//iconTag: The icon used for the window label and buttons. Reference Tocas UI for the iconTag information
//uid: The uid is the unique id for this window. If duplicated uid is found, the old window will be replaced.
//ww, wh: Window Width, Window Height
//posx, posy: Window Position x, Window Position y
//resizable: If the float window is resizable

class FloatWindow {
  constructor(src, title, iconTag="folder", uid ,ww=undefined, wh=undefined, posx=undefined, posy=undefined, resizable=true, glassEffect = false,parentUID = null, callBackFunct = null) {
	this.src =  location.href.replace(/[^/]*$/, '') + src;
	this.title = title;
	this.iconTag = iconTag;
	this.uid = uid;
    this.ww = ww;
    this.wh = wh;
	this.posx = posx;
	this.posy = posy;
	this.resizable = resizable;
	this.glassEffect = glassEffect;
	this.parentUID = parentUID;
	this.callBackFunct = callBackFunct;
  }
  
  // Method
  launch() {
    parent.newEmbededWindow(this.src,this.title,this.iconTag,this.uid,this.ww,this.wh,this.posx,this.posy,this.resizable,this.glassEffect,this.parentUID,this.callBackFunct);
  }
}