
/**
 * jquery.verySimpleImageViewer.js
 * Ver. : 1.0.0 
 * last update: 28/04/2018
 * Author: meshesha , https://github.com/meshesha
 * LICENSE: MIT
 * url:https://meshesha.github.io/verySimpleImageViewer
 */

(function ($) {
    $.fn.verySimpleImageViewer = function( options ) {
        var settings = $.extend(true,{},{
            // These are the defaults.
            imageSource: "",
            frame: ['720px','480px',false],
            maxZoom: '300%',
            zoomFactor: '10%',
            mouse: true,
            keyboard: true,
            toolbar: true,
            rotateToolbar: true
        }, options );

        var imageSource = settings.imageSource;
        var frame = settings.frame;
        var maxZoom = settings.maxZoom;
        var zoomFactor = settings.zoomFactor;
        var isMouse = settings.mouse;
        var isKeyboard = settings.keyboard;
        var isToolbar = settings.toolbar;
        var rotateToolbar = settings.rotateToolbar;

        var self = this;
        //var $result = $(this);
        var parent = $(this)[0];
        var image = null;
        var rotateAngle = 0;
        self.frameElement = null;
        var orignalW,orignalH, zoomLevel = 0;
        var lastMousePosition = null, speed = 5;
        var mouseWheelObject = null;

        console.log(settings)

        /*Methods*/
        self.getFrameDimension =  function() {
            return [self.frameElement.clientWidth,self.frameElement.clientHeight];
        }				
        self.setDimension = function(width,height) { //width and height of image
            image.width=Math.round(width);
            image.height=Math.round(height);
        }
        self.getDimension =  function() {
            return [image.width,image.height];
        }
        self.setPosition = function(x,y) { //x and y coordinate of image
            image.style.left=(Math.round(x)+'px');
            image.style.top=(Math.round(y)+'px');
        }
        self.getPosition = function() {
            return [retInt(image.style.left,'px'),retInt(image.style.top,'px')];
        }
        self.setMouseCursor = function() {
            var dimension = self.getDimension();
            var frameDimension =  self.getFrameDimension();
            
            var cursor='crosshair';
            if(dimension[0]>frameDimension[0] && dimension[1]>frameDimension[1])
                cursor='move';
            else if(dimension[0]>frameDimension[0])
                cursor='e-resize';
            else if(dimension[1]>frameDimension[1])
                cursor='n-resize';
            
            image.style.cursor=cursor;
        }
        self.maxZoomCheck = function(width,height) {
            if(typeof width=='undefined' || typeof height=='undefined') {
                var temp = self.getDimension();
                width=temp[0], height=temp[1];
            }
            if(typeof maxZoom=='number') {
                return ((width/orignalW)>maxZoom || (height/orignalH)>maxZoom);
            }
            else if(typeof maxZoom=='object') {
                return (width>maxZoom[0] || height>maxZoom[1]);
            }
        }
        self.fitToFrame = function(width, height) { //width and height of image
            if(typeof width=='undefined' || typeof height=='undefined') {
                width = orignalW, height = orignalH;
            }
            var frameDimension = self.getFrameDimension(), newWidth,newHeight;
            
            newWidth = frameDimension[0];
            newHeight = Math.round((newWidth*height)/width);
            if(newHeight>(frameDimension[1])) {
                newHeight = frameDimension[1];
                newWidth = Math.round((newHeight*width)/height); 
            }
            return [newWidth,newHeight];
        }
        self.getZoomLevel = function() {
            return zoomLevel;
        }
        self.zoomTo = function(newZoomLevel, x, y) {
            var frameDimension = self.getFrameDimension();
            //check if x and y coordinate is within the self.frameElement
            if(newZoomLevel<0 || x<0 || y<0 || x>=frameDimension[0] || y>=frameDimension[1])
                return false;
            
            var dimension = self.fitToFrame(orignalW,orignalH);
            for(var i=newZoomLevel; i>0;i--)
                dimension[0] *= zoomFactor, dimension[1] *= zoomFactor;
            
            //Calculate percentage increase/decrease and fix the image over given x,y coordinate
            var curWidth=image.width, curHeight=image.height;
            var position = self.getPosition();
            
            position[0]-=((x-position[0])*((dimension[0]/curWidth)-1)), position[1]-=((y-position[1])*((dimension[1]/curHeight)-1)); //Applying the above formula
            
            
            //Center image
            position = self.centerImage(dimension[0],dimension[1], position[0],position[1]);
            
            //Set dimension and position
            if(!self.maxZoomCheck(dimension[0],dimension[1])) {
                zoomLevel = newZoomLevel;
                self.setDimension(dimension[0],dimension[1]);
                self.setPosition(position[0],position[1]);
                self.setMouseCursor();
            }
            else
                return false;
            return true;
        }
        self.centerImage = function(width,height, x,y) { //width and height of image and (x,y) is the (left,top) of the image
            if(typeof width=='undefined' || typeof height=='undefined') {
                var temp = self.getDimension();
                width=temp[0], height=temp[1];
            }
            if(typeof x=='undefined' || typeof y=='undefined') {
                var temp = self.getPosition();
                x=temp[0], y=temp[1];
            }
                
            var frameDimension = self.getFrameDimension();
            
            if(width<=frameDimension[0])
                x = Math.round((frameDimension[0] - width)/2);
            if(height<=frameDimension[1])
                y = Math.round((frameDimension[1] - height)/2);

            if(width>frameDimension[0]) {
                if(x>0)
                    x=0;
                else
                if((x+width)<frameDimension[0])
                    x=frameDimension[0]-width;
            }

            if(height>frameDimension[1]) {
                if(y>0)
                    y=0;
                else
                if((y+height)<frameDimension[1])
                    y=frameDimension[1]-height;
            }

            return [x,y];
        }
        self.rotate = function(direction,reset){
            if(direction == "1"){
                rotateAngle += 90;
            }else{
                rotateAngle -= 90;
            }
            //console.log(self.frameElement)
            if(reset){
                $("." + self.frameElement.className +" .jqvsiv_main_image_content").css('transform','rotate(0deg)');
            }else{
                $("." + self.frameElement.className +" .jqvsiv_main_image_content").css('transform','rotate(' + rotateAngle + 'deg)');

                //need to reset mous position and direction - TODO
                
            }
        }
        self.reset = function() {
            var dimension = self.fitToFrame(orignalW,orignalH);
            var position = self.centerImage(dimension[0],dimension[1], 0,0);
            self.setDimension(dimension[0],dimension[1]);
            self.setPosition(position[0],position[1]);
            zoomLevel = 0;
            self.rotate("1",true);
        }
        
        /*Event handlers*/
        self.onmousewheel = function(event,object,direction) {
            self.frameElement.focus();
            if (!event){ //For IE
                event = window.event, event.returnValue = false;
            }else if (event.preventDefault){
                event.preventDefault();
            }

            if((zoomLevel+direction)>=0) {
                var mousePos = getMouseXY(event);
                var framePos = getObjectXY(self.frameElement);
                self.zoomTo(zoomLevel+direction, mousePos[0]-framePos[0], mousePos[1]-framePos[1]);
            }
        }
        self.onmousemove = function(event) {
            if (!event){ //For IE
                event = window.event, event.returnValue = false;
            }else if (event.preventDefault){
                event.preventDefault();
            }
            
            var mousePosition = getMouseXY(event);
            var position = self.getPosition();
            position[0] += (mousePosition[0]-lastMousePosition[0]), position[1]+=(mousePosition[1]-lastMousePosition[1]);
            lastMousePosition = mousePosition;
            
            position = self.centerImage(image.width,image.height, position[0],position[1]);
            self.setPosition(position[0],position[1]);
        }
        self.onmouseup_or_out = function(event) {
            if (!event){ //For IE
                event = window.event, event.returnValue = false;
            }else if (event.preventDefault){
                event.preventDefault();
            }
            
            image.onmousemove = image.onmouseup=image.onmouseout=null;
            image.onmousedown = self.onmousedown;
        }
        self.onmousedown =  function(event) {
            self.frameElement.focus();
            if (!event){ //For IE
                event = window.event, event.returnValue = false;
            }else if (event.preventDefault){
                event.preventDefault();
            }

            lastMousePosition = getMouseXY(event);
            image.onmousemove = self.onmousemove;
            image.onmouseup = image.onmouseout=self.onmouseup_or_out;
        }
        self.onkeypress = function(event) {
            var keyCode;
            if(window.event){ // IE
                event = window.event, keyCode = event.keyCode, event.returnValue = false;
            }else if(event.which){
                keyCode = event.which, event.preventDefault();
            }
            keyCode = String.fromCharCode(keyCode);
            
            var position = self.getPosition();
            var LEFT='a',UP='w',RIGHT='d',DOWN='s', CENTER_IMAGE='c', ZOOMIN='=', ZOOMOUT='-'; ///Keys a,w,d,s
            if(keyCode == LEFT){
                position[0]+=speed;
            }else if(keyCode == UP){
                position[1] += speed;
            }else if(keyCode == RIGHT){
                position[0] -= speed;
            }else if(keyCode==DOWN){
                position[1] -= speed;
            }else if(keyCode == CENTER_IMAGE || keyCode == 'C'){
                self.reset();
            }else if(keyCode == ZOOMIN || keyCode == '+' || keyCode == 'x' || keyCode == 'X'){
                self.zoomTo(zoomLevel+1, self.frameElement.clientWidth/2, self.frameElement.clientHeight/2);
            }else if( (keyCode == ZOOMOUT || keyCode == 'z' || keyCode == 'Z') && zoomLevel > 0){
                self.zoomTo(zoomLevel-1, self.frameElement.clientWidth/2, self.frameElement.clientHeight/2);
            }
            if(keyCode == LEFT || keyCode == UP || keyCode == RIGHT || keyCode == DOWN) {
                position = self.centerImage(image.width,image.height, position[0],position[1]);
                self.setPosition(position[0],position[1]);
                speed += 2;
            }
        }
        self.onkeyup = function(event) {
            speed = 5;
        }
        /*Initializaion*/
        self.setZoomProp = function(newZoomFactor,newMaxZoom) {
            if(newZoomFactor == null){
                zoomFactor = 10;
            }
            zoomFactor = 1 + retInt(newZoomFactor,'%')/100;
            
            if(typeof newMaxZoom == 'string'){
                maxZoom = retInt(newMaxZoom,'%')/100;
            }else if(typeof newMaxZoom == 'object' && newMaxZoom != null) {
                maxZoom[0] = retInt(newMaxZoom[0],'px');
                maxZoom[1] = retInt(newMaxZoom[1],'px');
            }else{
                maxZoom = '300%';
            } 
        }

        self.initImage = function() {
            image.style.maxWidth=image.style.width=image.style.maxHeight=image.style.height=null;
            orignalW=image.width;
            orignalH=image.height;
            
            var dimension = self.fitToFrame(orignalW, orignalH);
            self.setDimension(dimension[0],dimension[1]);
            
            if(frame[2] == true)
                self.frameElement.style.width = (Math.round(dimension[0])+ 'px');
            if(frame[3] == true)
                self.frameElement.style.height = (Math.round(dimension[1]) + 'px');
            
            var pos = self.centerImage(dimension[0],dimension[1], 0,0);
            self.setPosition(pos[0],pos[1]);
            self.setMouseCursor();
            
            //Set mouse handlers
            if(isMouse){
                mouseWheelObject = new mouseWheel();
                mouseWheelObject.init(image, self.onmousewheel);
                image.onmousedown = self.onmousedown;
            }
            //Set keyboard handlers
            if(isKeyboard){
                self.frameElement.onkeypress = self.onkeypress;
                self.frameElement.onkeyup = self.onkeyup;
            }
            //Set toolbar handlers
            if(isToolbar){
                self.loadToolbar(self);
            }
        }

        /*Set a base*/
        self.setZoomProp(zoomFactor,maxZoom);
        //Create self.frameElement - One time initialization
        self.frameElement = document.createElement('div');
        self.frameElement.className = 'image_viewer_inner_container';
        self.frameElement.style.width = frame[0];
        self.frameElement.style.height = frame[1];
        self.frameElement.style.border="0px solid #000";
        self.frameElement.style.margin="0px";
        self.frameElement.style.padding="0px";
        self.frameElement.style.overflow="hidden";
        self.frameElement.style.position="relative";
        self.frameElement.style.zIndex=2;
        self.frameElement.tabIndex=1;
                
        if(image!=null) {
            if (parent != null) {
                image.parentNode.removeChild(image);
                parent.appendChild(self.frameElement);
            }else{
                image.parentNode.replaceChild(self.frameElement,image);
            }
            
            image.style.margin=image.style.padding="0";
            image.style.borderWidth="0px";
            image.style.position='absolute';
            image.style.zIndex=3;
            self.frameElement.appendChild(image);
            
            //if(imageSource!=null)
            //	self.preInitImage();
            //else
            //	self.initImage();
        }else {		
            if(parent!=null)
                parent.appendChild(self.frameElement);
            
            var div_imge_container = document.createElement('div');
            div_imge_container.className = 'jqvsiv_main_image_content';

            image = document.createElement('img');
            image.className = 'image_container';
            image.style.position='absolute';
            image.style.zIndex=3;

            div_imge_container.appendChild(image);

            self.frameElement.appendChild(div_imge_container);
            
            image.onload = self.initImage;
            image.src = imageSource;
        }
        //Toolbar
        self.loadToolbar = function(self) {
            //var toolbarImages="./images/toolbar";
            var toolbar = document.createElement('div');
            toolbar.className='jqvsiv_toolbar';
            
            var isEnterKey = function(event) {
                var keyCode;
                if(event.keyCode){ // IE
                    keyCode = event.keyCode, event.returnValue = false;
                }else if(event.which){
                    keyCode = event.which, event.preventDefault();
                }

                return keyCode == 13;
            }
            
            var zoomIn = document.createElement('img');
            zoomIn.className='jqvsiv_toolbarButton';
            zoomIn.title='Zoom in';
            zoomIn.tabIndex="1";
            zoomIn.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABN0lEQVRIic3WMW6DMBQGYN+EqhGJJYZMvUMHpByAKceIKpYuGUqmLjFESIm6pQORgpSJwNYoYsiQsSfB9utSUBKZYgcs1dI/4s+8Z2NQf54MMUnzAUk5Jil0kd+58v48GSJM0ryriQXJUZcrF70J0rh6wCSF/wVYfgaWn+kBRusjUMaBMg72at89MN6eoBxOGIPpRXqBhxdfCmkFyCC1wGh9hPH2VOXt67sCprsDOGFcxV4maoDlZ0AZB9lRUAZ4ttEL9NxAWK7aEtmr/VUZprtDbYme3z9re/Jnk00vqh50wljYZFEukcZdVCIqwCUitU1NL1IGSkT6HNjLBArKoKDsquZNUfuazjbQcwPpydWBm8ZrAVSRu69MGcSYBLzVpd+EGO7ijNr+togQYxJww12cH18/nn4Aw1rF5Pti/U4AAAAASUVORK5CYII=";//toolbarImages+'/in.png';
            zoomIn.onclick = zoomIn.onkeypress = function(event) {
                event=event?event:window.event;
                if (event.type == 'keypress') 
                    if(!isEnterKey(event))
                        return;
                var frameDimension = self.getFrameDimension();
                self.zoomTo(self.getZoomLevel()+1, frameDimension[0]/2,frameDimension[1]/2);
            }
            
            var zoomOut = document.createElement('img');
            zoomOut.className='jqvsiv_toolbarButton';
            zoomOut.title='Zoom out';
            zoomOut.tabIndex="1";
            zoomOut.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAA3klEQVRIiWNQm7FPX2PmgbPqMw/805h54D81MNSss2oz9ukzaMw8cJZaBmPBZxmo6XJsPmGgoev/a8w88H/UglELaGiB/+rT/xO3XCQK+68+TZoF2rMO/v/z999/YsHvP3//a/Rtoq0FyrWz/6v2biQ+iHwWHfgfPW8rUdhj8pr/CtWz/itUz8KwBG8kq/ZsgGskBSNbQjAVUWoJUcmUEkuIzgfkWkJSRiPHEpJzMqmWkFVUkGIJ2VUmMZbIV87+R1GlT8gS+do5VxkobbZgs0S+cvY/+do5V5WalpgCAJUZolx/yaTFAAAAAElFTkSuQmCC";//toolbarImages+'/out.png';
            zoomOut.onclick = zoomOut.onkeypress = function(event) {
                event=event?event:window.event;
                if (event.type == 'keypress') 
                    if(!isEnterKey(event))
                        return;
                
                var frameDimension = self.getFrameDimension();
                self.zoomTo(self.getZoomLevel()-1, frameDimension[0]/2,frameDimension[1]/2);
            }
            
            var center = document.createElement('img');
            center.className='jqvsiv_toolbarButton';
            center.title='Center image';
            center.tabIndex="1";
            center.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABmklEQVRIic3WvWrCUBQH8LyJomiCQwO+Q7u0bl0FX0MsqCA6CEIXa+LXJqhQQUEc2pBqEWkJlXQrzSA6VKEfLkUo5t+hNURNNNEUeuGMOb+bc8/hXsKd4WiK4QWS4WWK4WFF/OYS3BmOJiiGF6xKrBECYeXOtf6E+MPdg2J4/H+AzrURaPStBU4q9/AWOqBzbXSGr5jLMvzVrnVAU5rg4eUD3dEbAODmaQgynIcrVd8f8LA8prMvLNbt8whkOA97iIU9xK4hpoHTSwHqJQzG8ESLCrCKmAaSPUlJ/v45Q0OUcHheXQLUiGkgci0i3urBl67BcZZdS7yKbAU87E9Zkj0JEe4R1AUHZ6y0MbE6dIHjyh2a0mTpQOOtHpyxkilEF/AWOuiPp0sH6kvXYA+xphBdgM61lT5fHKi65kYRTWAxoYs+FwZjNERp7WMjiCYQaPQxl2VlQj3RIo40WtEIolsif7W7NKGbYhOysU1dqbrhdtRDts7BvoihK3NXxBbMyoYv/V0QR6IsEmaeLUYRWzArOxJlkUxfHXwDNFegvBR/iaAAAAAASUVORK5CYII=";//toolbarImages+'/center.png';
            center.onclick = center.onkeypress = function(event) {
                event=event?event:window.event;
                if (event.type == 'keypress') 
                    if(!isEnterKey(event))
                        return;
                self.reset();
            }
            //self.rotate = function(direction)
            if(rotateToolbar){
                var rotateRight = document.createElement('img');
                rotateRight.className='jqvsiv_toolbarButton';
                rotateRight.title='Center image';
                rotateRight.tabIndex="1";
                rotateRight.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAB1ElEQVRIieXWwUvbYBjH8fwndRW7CoID3Wn3nYSdxIviQQa7bHdp62GIXvTiEBpTqUyZssKglk4UtJlawUmKshUtgtV6kMEs2m2lmpjvLrbM2TdrY3Yy8FwS+H3e503e943kCa60emVVeyirpldWcaKuszRPcKVV8sqq5lRwldIkJ0derRPpP44er6xyj4BXS2mKuoGcOuLR5KqzwJO3G6znTjEB48rk16XOSDLjDPBi4Quiq2k0ejegL75TCTvOFzCBC8Pg8PScrlCM2a1deiMb9oGD/E8A3iRSdIfjZL+f44+u4fYr9E4tVHCPRSdC4FlkC4CzYonGgEKDb+JGuf0KZ8USAB3jH4TTJQReLn0FYDN7ciu8XJvZEwCezyzS4JuoigiBnvltAHL5ghDI5QsAPB2LVO79jQiBFuUTPy50ALrD8VvhPeGPAJR0gwf+m8/+RCxf8nByH66//YFYkvbhadqGphmIJbkyTQB80bWq3ZURS6BZVpn6nBGug/daRjh9ZeTfKzmYoG9OZXnviOKlTkk3SOW+0anMW4aXq7a9KJigcfBdTYH2gDsg9W3XNpD6j8w6EFe/Yto79GtEXIFQWrL922KBuPoV0xUIpd2vZx7/Bh7Ty4bjzETnAAAAAElFTkSuQmCC";
                rotateRight.onclick = rotateRight.onkeypress = function(event) {
                    event=event?event:window.event;
                    if (event.type == 'keypress') 
                        if(!isEnterKey(event))
                            return;
                    
                    //var frameDimension = self.getFrameDimension();
                    self.rotate("1");
                }
                var rotateLeft = document.createElement('img');
                rotateLeft.className='jqvsiv_toolbarButton';
                rotateLeft.title='Center image';
                rotateLeft.tabIndex="1";
                rotateLeft.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAACQklEQVRIie3W3U9SYRwH8POfcEDj0Mtcq7XVP9BVra2tyy5aba1/wQOI2dxq3rQSeQ4qIdiLthZtNcSXc0wj8zgQCSEqmHOYLwnMCBU559uFwxREXoK7nu13+/38nme/59lDMcaRJjXhvYxJkDREQC2KMQmSmvBexjjSRKkJ761VcH6pCe+latn5YTuh6hWeq/9AbYBbb+cwubi+ubG9s5PYykhDkVVcfzP7b8BxIuDSgAjiXQAABJZ+Sh3DIh7xHoRX4llJlmFyzy9UDVwZFAEAsY10+pkYRKO+G+fv9+NMex9UWjN63X7IMnB74H2gKuCO04/cevc5Aprl8NLzBR3DImiWg0prxtfVBJyBKBru2T9WDOgmwsup7Qx6Pvhx4UF/AUCzHCxuP+K/N0GzXFGkKHCKjKcbW3vDuTCa5fB0Oojp6A+cbbeBZjn0TQX2AJrl0NBmK0COnCLGOBpX6syLuYATrRY8nwnhKnFA3dKDWOIXnIEo9jeRj5QcU+axK3bTNpRSac17Icf03XgxE0JWknHx4eABYBf5e1wlgRuvxVhWkhBaXgc34YN1KoDIWhKZrAStY7IgPB8p66Jds7jmHL5v+L6WxFIyhaH5KC53vioavh8pC2CIICvb7J9KBR5WZb9FjGlcUhmsYt2AXWQsSxusnroBGiJAY+IzSoN1tmyAIYJcKcJ0jW0pW574S4UrWCJRDBF8Fe+CCGC6+LRCbwkeCTRzQepkp+t01d8W02hKqTv4nOQ6VzRzQdVd+7k/U9So5+j1RlYAAAAASUVORK5CYII=";
                rotateLeft.onclick = rotateLeft.onkeypress = function(event) {
                    event=event?event:window.event;
                    if (event.type == 'keypress') 
                        if(!isEnterKey(event))
                            return;
                    
                    //var frameDimension = self.getFrameDimension();
                    self.rotate("-1");
                }
            }
            toolbar.appendChild(zoomIn);
            toolbar.appendChild(zoomOut);
            if(rotateToolbar){
                toolbar.appendChild(rotateRight);
                toolbar.appendChild(rotateLeft);
            }
            toolbar.appendChild(center);
            
            self.frameElement.appendChild(toolbar);
        }
    }
    function getObjectXY(object) {
        var left,top;
        objectCopy=object;
        if (object.offsetParent) {
            left=top=0;
            do {
                left += object.offsetLeft;
                if(object.style.borderLeftWidth!='')
                    left+=parseInt(object.style.borderLeftWidth);
                else
                    object.style.borderLeftWidth='0px';
                top += object.offsetTop;
                if(object.style.borderTopWidth!='')
                    top+=parseInt(object.style.borderTopWidth);
                else
                    object.style.borderTopWidth='0px';
            }
            while (object = object.offsetParent);
        }
        return [left-parseInt(objectCopy.style.borderLeftWidth),top-parseInt(objectCopy.style.borderLeftWidth)];
    }
    
    function retInt(str, suffix) {
        if(typeof str=='number')
            return str;
        var result=str.indexOf(suffix);
        return parseInt(str.substring(0,(result!=-1)?result:str.length))
    }
    
    /*Mouse related functions*/
    //Used to retrieve the mouse cursor position on screen (but event is needed as argument)
    function getMouseXY(event) {
        var posx = 0, posy = 0;
        if (!event) event = window.event;	//firefox
        if (event.pageX || event.pageY) {
            posx = event.pageX;
            posy = event.pageY;
        }
        else if (event.clientX || event.clientY) {	//IE
            posx = event.clientX + document.body.scrollLeft
                + document.documentElement.scrollLeft;
            posy = event.clientY + document.body.scrollTop
                + document.documentElement.scrollTop;
        }
        return [posx,posy];
    }
    
    function mouseWheel() {
        var self=this;
        /*Event handlers*/
        /*Mouse wheel functions*/
    
        //Default mouse wheel callback function
        //Variable local to 'this'
        var wheelCallback = function(event,object,delta){
            /*Override this function and write your code there*/
            /*
                delta=-1 when mouse wheel is rolled backwards (towards yourself)
                delta=1 when mouse wheel is rolled forward (away from one's self)
                Note: Here is where you can call the getMouseXY function using the 'event' argument
            */
        }
        //Mouse wheel event handler
        self.wheelHandler = function (event){
            var delta = 0;
            if (!event) //For IE
                event = window.event;
            if (event.wheelDelta) 	//IE
            {
                delta = event.wheelDelta/120;
                //if (window.opera) delta = -delta; //for Opera...hmm I read somewhere opera 9 need the delta sign inverted...tried in opera 10 and it doesnt require this!?
            }
            else if (event.detail) //firefox
                delta = -event.detail/3;
    
            if (event.preventDefault)
                event.preventDefault();
            event.returnValue = false;
            if (delta)
                wheelCallback(event,this,delta);	//callback function
        }
        //Mouse wheel initialization
        self.init = function(object,callback) {
            if (object.addEventListener) //For firefox
                object.addEventListener('DOMMouseScroll', this.wheelHandler, false); //Mouse wheel initialization
            //For IE
            object.onmousewheel = this.wheelHandler; //Mouse wheel initialization
            wheelCallback=callback;
        }
        this.setCallback = function(callback){
            wheelCallback=callback;
        }
    }
}(jQuery));
