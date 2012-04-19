
var nodeLogs = function(){
	var self = this;

	this.inProgress = false;
	
	//active file id
	this.activeFile = '';

	//connect websocket
	this.socket = io.connect();
	
	//upload functions
	this.upload = {
		file: 0,
		chunkSize: 65536,
		numChunks: 0,
		curChunk: 0,
		start: 0,
		end: 0,
		handleDragOver: function(e) {
			e.stopPropagation();
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
			$(this).css('background-color','grey');
		},
		handleDragLeave: function(e) {
			e.stopPropagation();
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
			$(this).css('background-color','');
		},
		handleFileSelect: function(e) {
			e.stopPropagation();
			e.preventDefault();
			$(this).css('background-color','');
			var files = e.dataTransfer.files; // FileList object.
			// one at a time please
			f = files[0];
			self.upload.file = f;
			self.upload.numChunks = Math.ceil( f.size / self.upload.chunkSize);
			//show overlay
			$('#overlay').show().append( $('<div id="name">'+f.name+'</div><div id="progress"><span class="right"/><div/></div>') ).removeClass('hide');
			
			self.socket.emit('newFile', {name: f.name, size: f.size}, function(id){
				console.log('fileID '+id);
				self.upload.start = new Date().getTime();
				self.upload.file.id = id;
				self.upload.file.read = 0;
				
				self.upload.readChunk();
			});
			
		},
		readChunk: function(){
			self.upload.file.overflow = self.upload.file.overflow || '';
			self.upload.file.read = self.upload.file.read || 0;
			self.upload.curChunk++;
			console.log( 'chunk: '+self.upload.curChunk+' of '+self.upload.numChunks);

			var progress = (self.upload.curChunk / self.upload.numChunks) * 100;
			var bytes = self.upload.curChunk * self.upload.chunkSize;
			var time = new Date().getTime()  - self.upload.start;
			var speed = Math.ceil( (bytes / 1024) / (time / 1000) );
			$('#progress > div').width(progress+'%');
			$('#progress > span').text(speed+'KB/s');
			
			var reader = new FileReader();
			reader.onloadend = function(evt) {
				// If we use onloadend, we need to check the readyFielde.
				if (evt.target.readyState == FileReader.DONE) { // DONE == 2
					self.upload.file.read = self.upload.file.read +self.upload.chunkSize;
					var chunk = evt.target.result;
					var lines = chunk.split('\n');
					lines[0] = self.upload.file.overflow + lines[0];
					if( self.upload.file.read < self.upload.file.size ){
						self.upload.file.overflow = lines.pop();
					}
					self.upload.sendLines(lines);
				}
			};

			if (self.upload.file.webkitSlice) {
				var blob = self.upload.file.webkitSlice(self.upload.file.read, self.upload.file.read + self.upload.chunkSize);
			} else if (self.upload.file.mozSlice) {
				var blob = self.file.mozSlice(self.upload.file.read, self.file.upload.read + self.upload.chunkSize);
			}
			reader.readAsText(blob);
		},
		sendLines: function(lines){
			self.socket.emit('uploadChunk', {file: self.upload.file.id, chunk: lines}, function(){
				console.log('chunkSent - '+lines.length+' lines');
				if( self.upload.file.read < self.upload.file.size ){
					self.upload.readChunk();
				}else{
					self.upload.end = new Date().getTime();
					self.upload.eof();
				}
			});
		},
		eof: function(){
			self.data.getFileList(self.render.fileList);
			$('#overlay').addClass('hide').children().remove();
			$('#overlay').hide();
		}
		
	}
	//click handlers
	this.eventHandler = {
		clickFile: function(e){
			e.preventDefault();
			e.stopPropagation();
			self.render.top.find('ul.fileList li.active').removeClass('active');
			$(this).parent().addClass('active');
			$('ul.fileList').hide();
			self.setFile( $(this).data().ID, function(){
				//set filename
				self.render.header();
				//draw minigraph
				self.data.getOverview(self.render.overview);
				//draw timeline graph
				self.data.getTimeline();
				//tail the file
				self.data.getHead(100, self.render.logList);
				//draw searchbox
				self.render.queryBox();
			});
		},
		showField: function(e){
			e.preventDefault();
			e.stopPropagation();
			$(this).children('').toggle();
		},
		resize: function(){
			//resize log window to fit
			//bit iffy in mac chrome still...
			var wH = $(window).height();
			var totHeight = 0;
			 $('body').children(':not(#app):not(#overlay)').each(function(){
				totHeight += $(this).outerHeight(true);
			});
			totHeight = totHeight + ( ($('body').children('br').length ) * 16) +20;
			self.render.app.height( wH - totHeight );
		},
		wrap: function(e){
			e.preventDefault();
			self.render.app.children('ul.logList').toggleClass('wrap');
		},
		toggleFileList: function(){
			$('ul.fileList').toggle();
		},
		queryKeyUp: function(e){
			if( !( 
					(e.keyCode >= 47 && e.keyCode <= 90) 
					|| (e.keyCode >= 187 && e.keyCode <= 192) 
					|| (e.keyCode >= 219 && e.keyCode <= 222) 
					|| e.keyCode == 46 
					|| e.keyCode == 13 
					|| e.keyCode == 8 
				) 
			){
				return;
			}
			
			try{
				
				var qry = $(this).val();
				qry = (qry == '') ? '{}' : qry;
				//automagic quoting!
				qry = qry.replace('"', '');
				qry = qry.replace("'",'');
				qry = qry.replace(/([^{}:,\s\]\[]+)/g, '"$1"');
				jQuery.parseJSON( qry );
				

				//dont actually try and send the query to the server unless we hit enter
				if( e.keyCode == 13 ){
					console.log('Sending query: ' + qry)
					self.data.setQuery(qry, function(d){
						if( d === false || d == 0){
							//invalid query
							self.render.query.children('input').addClass('invalid');
						}else{
							//console.log(d + ' results from query: ' + self.render.query.children('input').val() ) ;
							self.render.query.children('input').removeClass('invalid');
						}
					});
				}else{
					self.render.query.children('input').removeClass('invalid');
				}
			}catch(err){
				self.render.query.children('input').addClass('invalid');
			}
		},
		scrolLog: function(e){
			var scrollTop = $(this).prop('scrollTop');
			var scrollHeight = $(this).prop('scrollHeight');
			var height = $(this).height();
			var percent = (scrollTop + height) / scrollHeight;

			//flag so we dont stack up loads of requests if the connection is slow or you scroll like a ninja
			if( percent > 0.75 && !self.inProgress){
				// MOAR LINES
				self.inProgress = true;
				self.socket.emit('moreLines');
			}
		},
		setRange: function (e, ranges) {
			self.socket.emit('setRange', [ ranges.xaxis.from, ranges.xaxis.to ]);
		}
	}
	this.setFile = function(id, cb){
		self.activeFile = id;
		self.socket.emit('setFile', id, cb);
	}
	//data transfer
	this.data = {
		setQuery: function(qry, cb){
			self.socket.emit('setQuery', qry, cb);
		},
		getFile: function(cb){
			self.socket.emit('getFile', cb);
		},
		getFileList: function(cb){
			self.socket.emit('getFiles', cb);
		},
		getHead: function(n, cb){
			n = n || 100;
			self.socket.emit('getHead', n, cb);
		},
		getTimeline: function(){
			self.socket.emit('getTimeline');
		},
		getOverview: function(cb){
			self.socket.emit('getOverview',cb);
		}		
	}
	
	//rendering
	this.render = {
		app: $('#app'),
		top: $('#top'),
		graphDiv: $('#graph'),
		query: $('#query'),
		wrap: $('#top a.wrap'),
		graphPlot: null,
		overviewPlot: null,
		
		disconnect: function(){
			$('#overlay').show().append( $('<div id="name">Disconnected</div>') ).removeClass('hide');
		},
		reconnect: function(){
			$('#overlay').addClass('hide').children().remove()
			$('#overlay').hide();
		},
		header: function(){
			self.data.getFile(function(d){
				self.render.top.children('h1').html( templates.header({name: d.name}) );	
				
			});
		},
		fileList: function(files){
			if( self.render.top.children('div.fileList').length == 0 ){
				var div = $('<div class="fileList left"><span class="left round">Select File</span></div>')
					.prependTo(self.render.top)
					.click(self.eventHandler.toggleFileList);
				var ul = $('<ul class="fileList left round" />').appendTo(div);
			}else{
				var div = self.render.top.children('div.fileList');
				var ul = div.children('ul');
				ul.children().remove();
			}
			if( files.length == 0 ){ return; }
			
			for (i=0;i<files.length;i++){
				var file = files[i];
					file.lines = file.lines.toString().numberFormat();
					file.size = byteFormat(file.size);
				var li = $( templates.fileList(file) );
					li.appendTo(ul)
					.children('a')
					.data({ID: file._id})
					.click(self.eventHandler.clickFile);
				if( i == 0){
					li.addClass('round-tr round-tl');
				}
				if( i == files.length - 1){
					li.addClass('round-br round-bl');
				}
			}

		},
		logList: function(lines, append){
			append = append || false;
			if( !append ){ 
				self.render.app.children('ul.logList').html(''); 
			}			
			if( lines.length == 0 ){  self.render.wrap.hide(); return; }
			self.render.wrap.show();
			for ( num in lines ){
				self.render.appendLine(lines[num].line);
			}
		},
		appendLine: function(line){
			if( line.length == 0 ){  return; }
				var li = $('<li/>');
					li.text(line);
					li.appendTo( self.render.app.children('ul.logList') );
		},		
		queryBox: function(){
			self.render.query.children().remove();
			$('<input type="text" placeholder="Query MongoDB" class="round"/>').appendTo(self.render.query).keyup( self.eventHandler.queryKeyUp );
		},
		clearLog: function(){
			self.render.app.children('ul.logList').children().remove();
		},
		overview: function( timeline ){
			var options = {
				xaxis: { mode: "time", ticks: 0 },
				yaxis: {ticks: 0},
				grid: { color: '#ccc', backgroundColor: '#212121' },
				series: {
					lines: {fill: 0.8, fillColor: '#ED9D35'} 
				},
				selection: { mode: "x" }
			};

			self.render.overviewPlot = $.plot( $('.overview'), [timeline], options);
			//range selector
			$('.overview').bind('plotselected', self.eventHandler.setRange);
			$('.overview').bind('plotselected', function (event, ranges) {
				self.render.graphPlot.setSelection(ranges);
			});	
			$('.overview').bind('plotunselected',function () {
				var x = self.render.graphPlot.getXAxes();
				var y = self.render.graphPlot.getYAxes();
				var sel = {
						xaxis: {from: x[0].datamin, to: x[0].datamax}, 
						yaxis: {from: y[0].datamin, to: y[0].datamax},
					}
				//reset graph
				self.render.graphPlot.setSelection(sel);
				//reset loglist
				self.eventHandler.setRange('',{xaxis: {from:0,to:0}});
			});			
		},
		timeline: function( timeline ){
			//draw a graph yo!
			// realtime graph for later: http://people.iola.dk/olau/flot/examples/realtime.html

			var options = {
				xaxis: { mode: "time", twelveHourClock: false, timeformat: '%H:%M'  },
				grid: { hoverable: true, color: '#ccc', backgroundColor: '#212121' },
				series: {
					lines: {fill: 0.8, fillColor: '#ED9D35'} 
				}
			};

			self.render.graphPlot = $.plot( $('.graph'), [timeline], options);


	
			$('.graph').bind('plotselected', function (event, ranges) {
				// do the zooming
				self.render.graphPlot = $.plot($('.graph'), [timeline],
							$.extend(true, {}, options, {
								xaxis: { min: ranges.xaxis.from, max: ranges.xaxis.to }
							})
						);
				// don't fire event on the overview to prevent eternal loop
				//overview.setSelection(ranges, true);
			});			

			//tooltip
			$('.graph').bind('plothover', function(e,pos,item){
				if (item) {
					if( $('#tooltip').length != 0 ) {
						return;
					}
					var d = new Date( item.datapoint[0] );
						time = d.getDate().toString().padLeft(2,'0') + '-'+d.getMonth().toString().padLeft(2,'0') +'-'+d.getFullYear().toString().padLeft(2,'0') 
								+' '+d.getHours().toString().padLeft(2,'0') +':'+d.getMinutes().toString().padLeft(2,'0');
					var hits = item.datapoint[1];
					
					$('<div id="tooltip">' + time + ' '+hits + ' Requests</div>').addClass('round').css( {
						top: item.pageY - 5,
						left: item.pageX + 5
					}).appendTo("body");
				}else{
					$('#tooltip').remove();
				}
			});
			//resize overview to fit
			$('.overview').css('margin-left', self.render.graphPlot.offset().left - 7 +'px' );			
		}
	}
	
	this.init = function(){
		// Setup the dnd listeners.
		var dropZone = document.getElementById('drop');
		dropZone.addEventListener('dragover', self.upload.handleDragOver, false);
		dropZone.addEventListener('dragleave', self.upload.handleDragLeave, false);
		dropZone.addEventListener('drop', self.upload.handleFileSelect, false);

		//initial sizing 
		self.eventHandler.resize();
		
		$(window).resize(self.eventHandler.resize);
		
		self.render.wrap.click(self.eventHandler.wrap);
		self.data.getFileList(self.render.fileList);
		
		self.render.app.children('.logList').bind('scroll', self.eventHandler.scrolLog);
	}
	
	//websocket events
	this.socket.on('connect', function(){
		console.log('connected');
		if( self.activeFile != '' ){
			console.log('resetting current fileid to '+self.activeFile);
			self.setFile(self.activeFile, function(){});
		}
	});
	this.socket.on('disconnect', function(){
		console.log('disconnected');
		self.render.disconnect();
	});
	this.socket.on('reconnect', function(){
		console.log('reconnected');
		self.render.reconnect();
	});
	
	this.socket.on('queryUpdate', function(){
		self.render.clearLog();
	});
	this.socket.on('rangeUpdate', function(){
		console.log('range update');
		self.render.clearLog();
	});	
	this.socket.on('streamLine', function(line){
		self.render.appendLine(line.line);
	});
	this.socket.on('linesEnd', function(){
		self.inProgress = false;
	});	
	this.socket.on('timeline', function(timeline){
		self.render.timeline(timeline);
	});
	this.socket.on('newFile', function(timeline){
		self.data.getFileList(self.render.fileList);
	});	
	this.socket.once('connect', function(){
		//init after connect but only once
		self.init();
	});
	
};

//js string functions are awful
String.prototype.padLeft = function(num, chr){
	var str = this.toString();
	if( str.length >= num ){
		return str;
	}
	for( i=num; i>=str.length; i-- ){
		str = chr+str;
	}
	return str;
}
String.prototype.numberFormat = function(){
	var nStr = this.toString();
	nStr += '';
	x = nStr.split('.');
	x1 = x[0];
	x2 = x.length > 1 ? '.' + x[1] : '';
	var rgx = /(\d+)(\d{3})/;
	while (rgx.test(x1)) {
		x1 = x1.replace(rgx, '$1' + ',' + '$2');
	}
	return x1 + x2;
}
function byteFormat(num){
	if( num < 1024 ){ 
		return Math.round(num);
	}
	if( num < 1024*1024 ){ 
		return Math.round(num / 1024) + 'KB';
	}
	if( num < 1024*1024*1024 ){ 
		return Math.round(num / (1024*1024)) + 'MB';
	}
	if( num < 1024*1024*1024*1024 ){ 
		return Math.round(num / (1024*1024)) + 'GB';
	}	
}
var myLogs;
$(document).ready( function(){ 
	myLogs = new nodeLogs();
});

