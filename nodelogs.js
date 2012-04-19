var EventEmitter = require("events").EventEmitter;
var util = require("util");
var crypto = require('crypto');
var mongo = require('mongodb'),
  ObjectID = require('mongodb').ObjectID,
  Server = mongo.Server,
  Db = mongo.Db;
 
var fields = [
		'clientIP',
		'time',
		'method',
		'url',
		'httpver',
		'responsecode',
		'replysize',
		'squidcode'
]
  
var opts = {
	host: 'localhost',
	port: 27017
}

var server = new Server(opts.host, opts.port, {auto_reconnect: true});
var db = new Db('nodeLogs', server);

db.open(function(err, db) {
  if(!err) {
	console.log("MongoDB Connected");
  }
});

function nodeLogEntry(){
	var self = this;
	this.db = db;
	
	this.newFile = function(f, cb){
		console.log(f);
		self.db.collection('files', function(err,c){
			c.insert({name: f.name, size: f.size}, {safe: true}, function(err,res){
				//precreate collection + indexes
				self.db.createCollection('file'+res[0]._id, function(err,col){
					col.ensureIndex( {time:1}, {background: true} );
					/*
					col.ensureIndex( {clientIP:1}, {background: true} );
					col.ensureIndex( {method:1}, {background: true} );
					col.ensureIndex( {url:1}, {background: true} );
					col.ensureIndex( {httpver:1}, {background: true} );
					col.ensureIndex( {responsecode:1}, {background: true} );
					col.ensureIndex( {replysize:1}, {background: true} );
					col.ensureIndex( {squidcode:1}, {background: true} );
					*/
					
					self.emit('newFile');
					cb(res[0]._id);
				});

			});
		});
	}
	this.addChunk = function(fileID, chunk, cb){
		var count = chunk.length;
		var docs = [];
		function next(data){
			if( typeof(data) != 'undefined'){
				docs.push(data);
			}
			if( --count === 0 ) {
				//insert docs
				self.db.collection('file'+fileID, function(err,c){
					c.insert(docs, {safe: true, keepGoing: true}, function(){
						//update file data
						self.db.collection('files',function(err,c){
							//add last entry time
							c.update({ _id: ObjectID(fileID) }, { $inc: {lines: docs.length}, $set: {last: docs[docs.length-1].time }} );
							//add first entry time 
							c.findOne({ _id: ObjectID(fileID)}, {first:1}, function(err,result){
									if( typeof(result.first) == 'undefined'){
										c.update({ _id: ObjectID(fileID) }, { $inc: {lines: docs.length}, $set: {first: docs[0].time }} );
									}
							});

							
						});
						cb();
					});
				});
			}
		}
		for (i=0;i<chunk.length;i++){
			self.buildLine(fileID, chunk[i], next);
		}
	}
	
	this.buildLine = function(fileID, line,  next){
		if( typeof(line) == 'undefined' || line.length == 0 ){
			next();
			return;
		}
		
		var lineObj = {}
		try{
			lineObj.line = line;
			lineObj.time = line.match(/\[([^\]]*)\]/)[1];
			lineObj.time = new Date( lineObj.time.replace(':', ' ') );
			/*
			lineObj.clientIP = line.match(/^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/g)[0];
			
			//round time to the nearest minute
			
			lineObj.method = line.match(/\] "([A-Z]+) /)[1];
			lineObj.url = line.match(/\] "[A-Z]+ (.*) HTTP/)[1];
			var tmp = line.match( /HTTP\/(1.(1|0))" ([0-9]{0,3}) ([0-9]+) / );
			lineObj.httpver = tmp[1];
			lineObj.responsecode = tmp[3];
			lineObj.replysize = tmp[4];
			lineObj.squidcode = line.match( /TCP_[A-Z_:]+/ )[0];
			*/
		}catch(err){
			console.log(line);
			dumpError(err);
		}	
		next(lineObj);
		
	}

}

util.inherits(nodeLogEntry, EventEmitter);
module.exports.createNodeLogEntry = function(){
	return new nodeLogEntry();
}

function nodeLogQuery(){
	var self = this;
	this.db = db;

	//query params
	this.id = '';
	this.query = {};
	this.qryHash = '';	
	this.skip = 0;
	this.limit = 100;
	this.from = 0;
	this.to = 0;
	
	this.on('queryUpdate', function(){
		//these functions emit events which are picked up on the client
		//get first 100 lines
		self.getFilteredLines();
		//update graph
		self.getTimeline();
	});
	this.on('rangeUpdate', function(){
		//dont update timeline when time range is updated
		self.getFilteredLines();
	});
	this.setRange = function(range){
		if( range.length !== 2){
			return;
		}

		self.from = Math.floor(range[0]);
		self.to = Math.floor(range[1]);
		self.emit('rangeUpdate');
	}
	this.setQuery = function(qry, cb){
		if( qry == ''){
			cb(0);
			return;
		}
		//this is pretty ghetto but passing  regex object through json is unpossibles!
		//validation is done clientside and this is internal so shouldnt be a big deal
		try{
			qry = qry.replace(/("\/|\/([imxs])?")/g, "/$2");
			qrystring = qry;
			eval( 'var qry = '+qry+' ');
		} catch(err){
			cb(false);
			return;
		}

		if( compareObj(self.query, qry) ){
			//same query, dont bother sending data again!
			cb(true);
			return;
		}
		cb(true);

		self.query = qry;
		var md5 = crypto.createHash('md5');
		md5.update(qrystring);
		self.qryHash = md5.digest('hex');
		//reset offset
		self.skip = 0;
		self.emit('queryUpdate');

		//this checked if a query returned any results but i decided that sucked
		/*
		self.db.collection('file'+self.id, function(err,c){
			c.count(qry, function(err, num) {
				if( !err && num > 0){
					self.query = qry;
					var md5 = crypto.createHash('md5');
					md5.update(qrystring);
					self.qryHash = md5.digest('hex');
					cb(num);
					self.emit('queryUpdate');
				}else{
					cb(false);
				}
			});
		});
		*/

	}
	this.setFile = function(id){
		self.id = id;
	}
	this.getFiles = function(cb){
		self.db.collection('files', function(err,c){
			c.find().toArray(function(err, items) {
				if( items.length == 0){
					cb([]);
					return;
				}
				var count = items.length;
				var j = 0;
				function next(){
					j++;
					if( j == count  ){
						cb(items);
					}else{
						doDate(j)
					}
				}
				function doDate(i){
					items[i].first = (typeof(items[i].first) !== 'undefined') ? items[i].first.myFormat() : '';
					items[i].last = (typeof(items[i].last) !== 'undefined') ? items[i].last.myFormat() : '';
					next();
				}
				doDate(j);
				
			});
		});
	}
	this.getFile = function(cb){
		self.getFileData(self.id, cb);
	}
	this.getFileData = function(ID, cb){
		self.db.collection('files',function(err,c){
			c.findOne({ _id: ObjectID(ID) }, function(err,result){
					result.last = result.last.myFormat();
					result.first = result.first.myFormat();
				cb(result);
			});
		});
	}
	this.emitData = function(item){
		self.emit('streamLine', item);
	}
	this.emitEnd = function(){
		//emit
		self.emit('linesEnd');
		//next step!
		self.skip += self.limit;
	}
	this.getFilteredLines = function(){
		
		var qry = clone(self.query);
		
		if( self.from > 0 || self.to > 0){
			qry['time'] = {}
		}
		if( self.from != 0){
			qry['time']['$gte'] = new Date(self.from);
		}
		if( self.to != 0){
			qry['time']['$lt'] = new Date(self.to);
		}		
		
		
		self.db.collection('file'+self.id, function(err,c){
			var stream = c.find(qry, {line: 1}, {skip: self.skip, limit: self.limit}).stream();
			stream.on('data', self.emitData);
			stream.on('close', self.emitEnd);			
		});
	}
	this.getHead = function(n, cb){
		self.db.collection('file'+self.id, function(err,c){
			c.count(function(err,count){
				c.find({}, {line: 1}, {limit: n}).toArray(function(err,result){
					cb(result);
				});
			});
			
		});
	}
	//should roll these 2 into 1 function but...
	this.getOverview = function(cb){

		//cache timelines to collections, VASTLY faster
		self.db.collectionNames('timeline'+self.id + 'overview', function(err, items) {
			if( err !== null || items.length == 0){
				next();
			}else{
				self.db.collection('timeline'+self.id + 'overview', function(err,c){				
					c.find().toArray(function(err,result){ 
						var timeline = [];
						for( i in result ){
							timeline.push([ parseInt(result[i]._id), result[i].value ]);
						}
						cb(timeline);
					});
				});
			}
		});		
		function next(){	
			self.db.collection('file'+self.id, function(err,c){
				var map = function(){
					emit( this.time - (this.time  % (60*1000) ), 1 );
				}
				var reduce = function(k, vals){
					var sum = 0;
					for(var i in vals) {
						sum += vals[i];
					}
					return sum;
				}
				c.mapReduce(map, reduce, {query: self.query, out: {replace: 'timeline'+self.id +'overview'}}, function(err, c){
					c.find().toArray(function(err,result){
						var timeline = [];
						for( i in result ){
							timeline.push([ parseInt(result[i]._id), result[i].value ]);
						}
						cb(timeline);
					});
				});
			});		
		}
	}
	this.getTimeline = function(){
		//TODO: check if a query will return anything before we bother mapreducing?

		//cache timelines to collections, VASTLY faster
		self.db.collectionNames('timeline'+self.id + self.qryHash, function(err, items) {
			if( err !== null || items.length == 0){
				next();
			}else{
				self.db.collection('timeline'+self.id + self.qryHash, function(err,c){				
					c.find().toArray(function(err,result){ 
						var timeline = [];
						for( i in result ){
							timeline.push([ parseInt(result[i]._id), result[i].value ]);
						}
						self.emit('timeline', timeline);
					});
				});
			}
		});

		//generate timeline from scratch
		function next(){
			self.db.collection('file'+self.id, function(err,c){
				var map = function(){
					emit( this.time - (this.time  % (60*1000) ), 1 );
				}
				var reduce = function(k, vals){
					var sum = 0;
					for(var i in vals) {
						sum += vals[i];
					}
					return sum;
				}
				c.mapReduce(map, reduce, {query: self.query, out: {replace: 'timeline'+self.id + self.qryHash}}, function(err, c){
					c.find().toArray(function(err,result){
						var timeline = [];
						for( i in result ){
							timeline.push([ parseInt(result[i]._id), result[i].value ]);
						}
						self.emit('timeline', timeline);
					});
				});
			});
		}
	}
}
util.inherits(nodeLogQuery, EventEmitter);
module.exports.createNodeLogQuery = function(){
	return new nodeLogQuery();
}

//basic date formatting
Date.prototype.myFormat = function(){
	d = this;
	var days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
	var out = '';
	out += days[d.getDay()];
	out += ' ' + d.getDate().toString().padLeft(2,0);
	out += '-'+ (parseInt(d.getMonth())+1).toString().padLeft(2,0);
	out += '-'+ d.getFullYear().toString().padLeft(2,0);
	out += ' '+ d.getHours().toString().padLeft(2,0);
	out += ':'+ d.getMinutes().toString().padLeft(2,0);
	return out;
}
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
//clone object
function clone(obj) {
	var tmp = (obj instanceof Array) ? [] : {};
	for (var i in obj) {
		tmp[i] = ( typeof(obj[i]) === 'object' ) ? clone(obj[i]) : obj[i];
	}
	return tmp;
}
//object comparison helper
function compareObj( x, y ) {
	if ( x === y ) return true;
	if ( ! ( x instanceof Object ) || ! ( y instanceof Object ) ) return false;
	if ( x.constructor !== y.constructor ) return false;
		for ( var p in x ) {
			if ( ! x.hasOwnProperty( p ) ) continue;
			if ( ! y.hasOwnProperty( p ) ) return false;
			if ( x[ p ] === y[ p ] ) continue;
			if ( typeof( x[ p ] ) !== "object" ) return false;
			if ( ! compareObj( x[ p ],  y[ p ] ) ) return false;
	}
	for ( p in y ) {
		if ( y.hasOwnProperty( p ) && ! x.hasOwnProperty( p ) ) return false;
	}
	return true;
}

function dumpError(err) {
	if (typeof err === 'object') {
		if (err.message) {
			console.log('\nMessage: ' + err.message)
		}
		if (err.stack) {
			console.log('\nStacktrace:')
			console.log('====================')
			console.log(err.stack);
		}
	} else {
		console.log('dumpError :: argument is not an object');
	}
}