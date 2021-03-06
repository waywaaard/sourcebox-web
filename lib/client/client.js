'use strict';

var util = require('util');
var events = require('events');

var Promise = require('bluebird');
var _ = require('lodash');
var debug = require('debug')('sourcebox:client');
var io = require('socket.io-client');

var Process = require('./process');
var sbutil = require('../common/util');

function Client(url, options) {
  if (!(this instanceof Client)) {
    return new Client(url, options);
  }

  Client.super_.call(this);

  if (url instanceof io) {
    this.socket = io;
  } else {
    this.socket = io(url, options);
  }

  this.auth = options && options.auth;
  this._bind();
}

util.inherits(Client, events.EventEmitter);

Client.prototype._bind = function () {
  var self = this;

  this.socket.on('connect', this._onConnect.bind(this));

  this.socket.on('fatal', function (error) {
    error = new Error(error);
    debug('error', error.message);
    self.emit('error', error);
  });

  // re-emit socket.io events
  ['disconnect', 'reconnect', 'error'].forEach(function (event) {
    self.socket.on(event, function () {
      var args = _.toArray(arguments);
      debug(event, args);

      args.unshift(event);
      self.emit.apply(self, args);
    });
  }, this);
};

Client.prototype._onConnect = function () {
  debug('connect');
  this.emit('connect');
  this.socket.emit('auth', _.isFunction(this.auth) ? this.auth() : this.auth);
};

Client.prototype._call = function () {
  var args = _.toArray(arguments);

  return new Promise(function (resolve, reject) {
    args.push(function (err, data) {
      if (err != null) {
        reject(sbutil.objectToError(err));
      } else {
        resolve(data);
      }
    });

    this.socket.emit.apply(this.socket, args);
  }.bind(this));
};

Client.prototype.readFile = function (file, encoding) {
  return this._call('readFile', file)
    .then(function (data) {
      if (encoding === null) {
        // user explicitely passed 'null', return binary data
        return data;
      } else {
        return new Buffer(data).toString(encoding || 'utf8');
      }
    })
    .tap(debug);
};

Client.prototype.writeFile = function (file, data, encoding) {
  var buffer = new Buffer(data, encoding);
  return this._call('writeFile', file, buffer.buffer);
};

['mkdir', 'rm', 'cp', 'ln'].forEach(function (method) {
  Client.prototype[method] = function (array, options, errorHandler) {
    errorHandler = errorHandler != null ? errorHandler : function noopHandler() {};
    return this._call(method, array, options)
      .catch(errorHandler)
      .tap(debug);
  };
});

Client.prototype.exec = function (command, args, options) {
  if (!_.isArray(args)) {
    options = args;
    args = [];
  }

  if (options === undefined)  {
    options = {};
  }

  return new Process(this.socket, command, args, options);
};

module.exports = Client;
