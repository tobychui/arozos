//Memo Wall Javascript
	//Global variables
	var color = "#ffffff";
	var fontcolor = "#000000";
	var username = "Unknown";
	var editmode = false;
	var editid = 0;
	
	$( document ).ready(function() {
		//Check if user have identified themselve
		if (localStorage.getItem("ArOZusername") === null){
			//Non-identified user
		}else{
			console.log(localStorage.ArOZusername);	
			username = localStorage.ArOZusername;
		}
		
		//Set Identification of user
		$('#writerName').html("Identification: " + username);
		//Reset font color to black
		$('#color_value').val('000000');
	});
	
	$('textarea').each(function () {
	  this.setAttribute('style', 'height:' + (this.scrollHeight) + 'px;overflow-y:hidden;');
	}).on('input', function () {
	  this.style.height = 'auto';
	  this.style.height = (this.scrollHeight) + 'px';
	});
	
	function PinMemo(id){
		console.log(id);
		$.ajax({
			data: 'id=' + id,
			url: 'MemoPin.php',
			method: 'POST', // or GET
			success: function(msg) {
				console.log(msg);
				if (msg == "DONE"){
					location.reload(); 
				}
			}
		});
	}
	
	function RemoveMemo(id){
		console.log(id);
		$.ajax({
			data: 'id=' + id,
			url: 'MemoDel.php',
			method: 'POST', // or GET
			success: function(msg) {
				console.log(msg);
				if (msg == "DONE"){
					location.reload(); 
				}
			}
		});
	}
	
	function EditMemo(id){
		$("html, body").animate({ scrollTop: 0 }, "slow");
		editmode = true;
		$('#cencelbtn').show();
		$('#memoContent').val($('#' + id + '-content').html().trim().replace("<br>","\n"));
		$('#memoTitle').val($('#' + id + '-title').html().trim().replace("<br>","\n"));
		editid = id;
	}
	
	function CancelEdit(){
		$('#memoContent').val("");
		$('#memoTitle').val("");
		$('#color_value').val('000000');
		editmode = false;
		$('#cencelbtn').hide();
		editid = 0;
	}
	
	function setFontColor(picker){
		fontcolor = "#" + picker.toString();
		$('#memoContent').css("color",'#' + picker.toString());
	}
	
	function setColor(picker){
		//console.log('#' + picker.toString());
		$('#memoContent').css("background-color",'#' + picker.toString());
		color = '#' + picker.toString();
	}
	
	
	
	
	function SaveMemo(){
		var content = $('#memoContent').val();
		var title = $('#memoTitle').val();
		$('#memoContent').val("");
		$('#memoTitle').val("");
		$('#color_value').val('000000');
		if (editmode == false){
			$.ajax({
				data: 'content=' + content + '&title=' + title + '&bgcolor=' + color + '&fontcolor=' + fontcolor + '&username=' + username,
				url: 'MemoSave.php',
				method: 'POST', // or GET
				success: function(msg) {
					console.log(msg);
					if (msg == "DONE"){
						location.reload(); 
					}
				}
			});
		}else{
			console.log(content);
			$.ajax({
				data: 'content=' + content + '&title=' + title + '&bgcolor=' + color + '&fontcolor=' + fontcolor + '&username=' + username + '&id=' + editid,
				url: 'MemoEdit.php',
				method: 'POST', // or GET
				success: function(msg) {
					console.log(msg);
					if (msg == "DONE"){
						location.reload(); 
					}
				}
			});
		}
	}