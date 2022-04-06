/*
    On Screen Keyboard

    A simple on screen keyboard for touch devices that run linux
    (Yes, just in case I need to run ArozOS on embedded linux with browser
        this will be helpful in those rare cases)

    author: tobychui
*/

//Handle ArozOS key event passthrough
if (ao_module_virtualDesktop){
	if (!parent.window.ime){
		alert("Unsupported viewing mode or version of ArozOS too old!")
	}else{
		parent.window.ime.handler = handleKeydownInput;
	}

    //Define this is the ime window
    ao_module_ime = true;
}

function handleKeydownInput(e) {
    //No need to do anything as the default events will fire
}

//Handle text injection to other iframes
function addtext(text){
	if (text.includes('"')){
		text = text.replace('"','');
    }

    var focused = $(':focus');
	insertAtCaret(focused[0],text)
	preword = text;
	
	if (parent.window.ime && parent.window.ime.focus != null){
        if (text == "\n" && parent.window.ime.focus.tagName.toLowerCase() == "input"){
            //Enter. If target is INPUT send enter keypress instead
            //console.log("Triggered!", $(parent.window.ime.focus));
            let event = new Event('keypress');
            event.keyCode = 13;
            event.which = 13;
            event.key = 'enter';
            console.log(event);
            parent.window.ime.focus.dispatchEvent(event);
            //$(parent.window.ime.focus).trigger(jQuery.Event( "keypress", { keyCode: 13 } ));
        }else{
            insertAtCaret(parent.window.ime.focus, text);
        }
		
	}
}

function backSpace(){
    if (parent.window.ime && parent.window.ime.focus != null){
		backSpaceAtCaret(parent.window.ime.focus);
	}
}

function backSpaceAtCaret(target){
    var txt = $(target);
    var startPos = txt[0].selectionStart;
    var endPos = txt[0].selectionEnd;
    var scrollPos = txt[0].scrollTop;
    //console.log("start: " + startPos + " end: " + endPos + " scrollPos: " + scrollPos);
    if (endPos - startPos > 0){
        txt.val(txt.val().slice(0, startPos) + txt.val().slice(endPos, 100));
    }else if (endPos > 0){
        txt.val(txt.val().slice(0, startPos-1) + txt.val().slice(startPos, 100));
    }else{
        startPos = txt.val().length+1;
    }
    txt.focus();
    txt[0].setSelectionRange(startPos-1,startPos-1);
}

function insertAtCaret(target, text) {
    var txtarea = target;
	if (txtarea == undefined){
		return
	}
    var scrollPos = txtarea.scrollTop;
    var caretPos = txtarea.selectionStart;

    var front = (txtarea.value).substring(0, caretPos);
    var back = (txtarea.value).substring(txtarea.selectionEnd, txtarea.value.length);
    txtarea.value = front + text + back;
    caretPos = caretPos + text.length;
    txtarea.selectionStart = caretPos;
    txtarea.selectionEnd = caretPos;
    txtarea.focus();
    txtarea.scrollTop = scrollPos;
}

//Overwrite the ao_module close handler
function ao_module_close(){
	//Deregister this IME from the window object
	if (parent.window.ime.handler == handleKeydownInput){
		parent.window.ime.handler = null;
	}
	//Exit IME
	closeThisWindow();
}

function closeThisWindow(){
	if (!ao_module_virtualDesktop){
		window.close('','_parent','');
		window.location.href = ao_root + "SystemAO/closeTabInsturction.html";
		return;
	}
	parent.closeFwProcess(ao_module_windowID);
}
