/**
 * Module dependencies.
 */

var express = require('express'),
	gzip = require('connect-gzip'),
	io = require('socket.io');

var nodeLogs = require('./nodeLogs.js');
var templates = require('./template.js');
var tpl = templates.watch(__dirname+'/public/templates/');

var app = module.exports = express.createServer();
io = io.listen(app);

io.configure(function(){
	//io.set('transports', ['websocket']);
	io.set('log level', 1);
	io.enable('browser client minification');
	io.enable('browser client etag');
});



// Configuration
app.configure(function(){
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    //app.set('jsonp callback', true);
	app.use(gzip.gzip());
    //app.use(express.bodyParser());
    app.use(express.cookieParser());
    app.use(express.session({secret:'asdfasdfasdfdghjfkkj'}));  
    app.use(express.methodOverride());
    app.use(app.router);
});
app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
	app.use(express.static(__dirname + '/public'));
});
app.configure('production', function(){
    app.use(express.errorHandler()); 
	app.use(gzip.staticicGzip(__dirname + '/public'));
});

//websockets 
var logEntry = nodeLogs.createNodeLogEntry();
logEntry.on('newFile', function(){
	//push new file notification out to all clients
	io.sockets.emit('newFile');
});
io.sockets.on('connection', function (socket) {
	//each client has its own nodeLogQuery instance
	// maybe we should just pass the socket object to nodeLogQuery and bind there?
	var logQuery = nodeLogs.createNodeLogQuery();
	console.log('client connected');

	logQuery.on('queryUpdate', function(){
		socket.emit('queryUpdate');
	});
	logQuery.on('rangeUpdate', function(){
		socket.emit('rangeUpdate');
	});	
	logQuery.on('newLines', function(){
		socket.emit('newLines');
	});
	logQuery.on('streamLine', function(item){
		socket.emit('streamLine', item);
	});
	logQuery.on('linesEnd', function(){
		socket.emit('linesEnd');
	});
	logQuery.on('timeline', function(d){
		socket.emit('timeline',d);
	});	
	
	socket.on('newFile', logEntry.newFile);

	socket.on('uploadChunk', function (data,fn) {
		console.log('new data chunk - file '+data.file+' - lines '+data.chunk.length);
		logEntry.addChunk(data.file, data.chunk, fn);
	});
	socket.on('moreLines', logQuery.getFilteredLines);

	socket.on('getFiles', function(cb){
		logQuery.getFiles(cb);
	});

	//configure query
	socket.on('setQuery',logQuery.setQuery);
	socket.on('setRange', logQuery.setRange);

	socket.on('setFile', function(data,fn){
		logQuery.setFile(data);
		fn(true);
	});
	socket.on('getHead',logQuery.getHead);
	socket.on('getTimeline', logQuery.getTimeline);
	socket.on('getOverview', logQuery.getOverview);
	socket.on('getFile', logQuery.getFile);
});


app.get('/', function(req, res){
    //console.log('index requested');
    //console.log(req.query);
    res.render('index', {title:'Node Logs', jsfile:'main', templates: tpl.writeTemplates() });
});

app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
