/* dropsheet.js (C) 2014-present SheetJS -- http://sheetjs.com */
/* vim: set ts=2: */

var DropSheet = function DropSheet(opts) {
	if(!opts) opts = {};
	var nullfunc = function(){};
	if(!opts.errors) opts.errors = {};
	if(!opts.errors.badfile) opts.errors.badfile = nullfunc;
	if(!opts.errors.pending) opts.errors.pending = nullfunc;
	if(!opts.errors.failed) opts.errors.failed = nullfunc;
	if(!opts.errors.large) opts.errors.large = nullfunc;
	if(!opts.on) opts.on = {};
	if(!opts.on.workstart) opts.on.workstart = nullfunc;
	if(!opts.on.workend) opts.on.workend = nullfunc;
	if(!opts.on.sheet) opts.on.sheet = nullfunc;
	if(!opts.on.wb) opts.on.wb = nullfunc;

	var rABS = typeof FileReader !== 'undefined' && FileReader.prototype && FileReader.prototype.readAsBinaryString;
	var useworker = typeof Worker !== 'undefined';
	var pending = false;
	function fixdata(data) {
		var o = "", l = 0, w = 10240;
		for(; l<data.byteLength/w; ++l)
			o+=String.fromCharCode.apply(null,new Uint8Array(data.slice(l*w,l*w+w)));
		o+=String.fromCharCode.apply(null, new Uint8Array(data.slice(o.length)));
		return o;
	}

	function sheetjsw(data, cb, readtype) {
		pending = true;
		opts.on.workstart();
		var scripts = document.getElementsByTagName('script');
		var dropsheetPath;
		for (var i = 0; i < scripts.length; i++) {
			if (scripts[i].src.indexOf('dropsheet') != -1) {
				dropsheetPath = scripts[i].src.split('dropsheet.js')[0];
			}
		}
		var worker = new Worker(dropsheetPath + 'sheetjsw.js');
		worker.onmessage = function(e) {
			switch(e.data.t) {
				case 'ready': break;
				case 'e': pending = false; console.error(e.data.d); break;
				case 'xlsx':
					pending = false;
					opts.on.workend();
					cb(JSON.parse(e.data.d)); break;
			}
		};
		worker.postMessage({d:data,b:readtype,t:'xlsx'});
	}

	var last_wb;

	function to_json(workbook) {
		if(useworker && workbook.SSF) XLSX.SSF.load_table(workbook.SSF);
		var result = {};
		workbook.SheetNames.forEach(function(sheetName) {
			var roa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header:1});
			if(roa.length > 0) result[sheetName] = roa;
		});
		return result;
	}

	function choose_sheet(sheetidx) { process_wb(last_wb, sheetidx); }

	function process_wb(wb, sheetidx) {
		last_wb = wb;
		opts.on.wb(wb, sheetidx);
		var sheet = wb.SheetNames[sheetidx||0];
		var json = to_json(wb)[sheet];
		opts.on.sheet(json, wb.SheetNames, choose_sheet);
	}

	function handleDrop(e) {
		e.stopPropagation();
		e.preventDefault();
		if(pending) return opts.errors.pending();
		var files = e.dataTransfer.files;
		var i,f;
		for (i = 0, f = files[i]; i != files.length; ++i) {
			var reader = new FileReader();
			var name = f.name;
			reader.onload = function(e) {
				var data = e.target.result;
				var wb, arr;
				var readtype = {type: rABS ? 'binary' : 'base64' };
				if(!rABS) {
					arr = fixdata(data);
					data = btoa(arr);
				}
				function doit() {
					try {
						if(useworker) { sheetjsw(data, process_wb, readtype); return; }
						wb = XLSX.read(data, readtype);
						process_wb(wb);
					} catch(e) { console.log(e); opts.errors.failed(e); }
				}

				if(e.target.result.length > 1e6) opts.errors.large(e.target.result.length, function(e) { if(e) doit(); });
				else { doit(); }
			};
			if(rABS) reader.readAsBinaryString(f);
			else reader.readAsArrayBuffer(f);
		}
	}

	function handleDragover(e) {
		e.stopPropagation();
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}

	if(opts.drop.addEventListener) {
		opts.drop.addEventListener('dragenter', handleDragover, false);
		opts.drop.addEventListener('dragover', handleDragover, false);
		opts.drop.addEventListener('drop', handleDrop, false);
	}

};
