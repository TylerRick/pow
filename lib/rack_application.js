(function() {
  var RackApplication, async, basename, bufferLines, exists, fs, join, nack, pause, sourceScriptEnv, _ref, _ref2;

  async = require("async");

  fs = require("fs");

  nack = require("nack");

  _ref = require("./util"), bufferLines = _ref.bufferLines, pause = _ref.pause, sourceScriptEnv = _ref.sourceScriptEnv;

  _ref2 = require("path"), join = _ref2.join, exists = _ref2.exists, basename = _ref2.basename;

  module.exports = RackApplication = (function() {

    function RackApplication(configuration, root) {
      this.configuration = configuration;
      this.root = root;
      this.logger = this.configuration.getLogger(join("apps", basename(this.root)));
      this.readyCallbacks = [];
      this.quitCallbacks = [];
      this.statCallbacks = [];
    }

    RackApplication.prototype.ready = function(callback) {
      if (this.state === "ready") {
        return callback();
      } else {
        this.readyCallbacks.push(callback);
        return this.initialize();
      }
    };

    RackApplication.prototype.quit = function(callback) {
      if (this.state) {
        if (callback) this.quitCallbacks.push(callback);
        return this.terminate();
      } else {
        return typeof callback === "function" ? callback() : void 0;
      }
    };

    RackApplication.prototype.queryRestartFile = function(callback) {
      var _this = this;
      return fs.stat(join(this.root, "tmp/restart.txt"), function(err, stats) {
        var lastMtime;
        if (err) {
          _this.mtime = null;
          return callback(false);
        } else {
          lastMtime = _this.mtime;
          _this.mtime = stats.mtime.getTime();
          return callback(lastMtime !== _this.mtime);
        }
      });
    };

    RackApplication.prototype.setPoolRunOnceFlag = function(callback) {
      var _this = this;
      if (!this.statCallbacks.length) {
        exists(join(this.root, "tmp/always_restart.txt"), function(alwaysRestart) {
          var statCallback, _i, _len, _ref3;
          _this.pool.runOnce = alwaysRestart;
          _ref3 = _this.statCallbacks;
          for (_i = 0, _len = _ref3.length; _i < _len; _i++) {
            statCallback = _ref3[_i];
            statCallback();
          }
          return _this.statCallbacks = [];
        });
      }
      return this.statCallbacks.push(callback);
    };

    RackApplication.prototype.loadScriptEnvironment = function(env, callback) {
      var _this = this;
      return async.reduce([".powrc", ".envrc", ".powenv"], env, function(env, filename, callback) {
        var script;
        return exists(script = join(_this.root, filename), function(scriptExists) {
          if (scriptExists) {
            return sourceScriptEnv(script, env, callback);
          } else {
            return callback(null, env);
          }
        });
      }, callback);
    };

    RackApplication.prototype.loadRvmEnvironment = function(env, callback) {
      var script,
        _this = this;
      return exists(script = join(this.root, ".rvmrc"), function(rvmrcExists) {
        var rvm;
        if (rvmrcExists) {
          return exists(rvm = _this.configuration.rvmPath, function(rvmExists) {
            var before;
            if (rvmExists) {
              before = "source '" + rvm + "' > /dev/null";
              return sourceScriptEnv(script, env, {
                before: before
              }, callback);
            } else {
              return callback(null, env);
            }
          });
        } else {
          return callback(null, env);
        }
      });
    };

    RackApplication.prototype.loadEnvironment = function(callback) {
      var _this = this;
      return this.queryRestartFile(function() {
        return _this.loadScriptEnvironment(_this.configuration.env, function(err, env) {
          if (err) {
            return callback(err);
          } else {
            return _this.loadRvmEnvironment(env, function(err, env) {
              if (err) {
                return callback(err);
              } else {
                return callback(null, env);
              }
            });
          }
        });
      });
    };

    RackApplication.prototype.initialize = function() {
      var _this = this;
      if (this.state) {
        if (this.state === "terminating") {
          this.quit(function() {
            return _this.initialize();
          });
        }
        return;
      }
      this.state = "initializing";
      return this.loadEnvironment(function(err, env) {
        var readyCallback, _i, _len, _ref3, _ref4, _ref5;
        if (err) {
          _this.state = null;
          _this.logger.error(err.message);
          _this.logger.error("stdout: " + err.stdout);
          _this.logger.error("stderr: " + err.stderr);
        } else {
          _this.state = "ready";
          _this.pool = nack.createPool(join(_this.root, "config.ru"), {
            env: env,
            size: (_ref3 = env != null ? env.POW_WORKERS : void 0) != null ? _ref3 : _this.configuration.workers,
            idle: ((_ref4 = env != null ? env.POW_TIMEOUT : void 0) != null ? _ref4 : _this.configuration.timeout) * 1000
          });
          bufferLines(_this.pool.stdout, function(line) {
            return _this.logger.info(line);
          });
          bufferLines(_this.pool.stderr, function(line) {
            return _this.logger.warning(line);
          });
          _this.pool.on("worker:spawn", function(process) {
            return _this.logger.debug("nack worker " + process.child.pid + " spawned");
          });
          _this.pool.on("worker:exit", function(process) {
            return _this.logger.debug("nack worker exited");
          });
        }
        _ref5 = _this.readyCallbacks;
        for (_i = 0, _len = _ref5.length; _i < _len; _i++) {
          readyCallback = _ref5[_i];
          readyCallback(err);
        }
        return _this.readyCallbacks = [];
      });
    };

    RackApplication.prototype.terminate = function() {
      var _this = this;
      if (this.state === "initializing") {
        return this.ready(function() {
          return _this.terminate();
        });
      } else if (this.state === "ready") {
        this.state = "terminating";
        return this.pool.quit(function() {
          var quitCallback, _i, _len, _ref3;
          _this.state = null;
          _this.mtime = null;
          _this.pool = null;
          _ref3 = _this.quitCallbacks;
          for (_i = 0, _len = _ref3.length; _i < _len; _i++) {
            quitCallback = _ref3[_i];
            quitCallback();
          }
          return _this.quitCallbacks = [];
        });
      }
    };

    RackApplication.prototype.handle = function(req, res, next, callback) {
      var resume,
        _this = this;
      resume = pause(req);
      return this.ready(function(err) {
        if (err) return next(err);
        return _this.setPoolRunOnceFlag(function() {
          return _this.restartIfNecessary(function() {
            req.proxyMetaVariables = {
              SERVER_PORT: _this.configuration.dstPort.toString()
            };
            try {
              return _this.pool.proxy(req, res, function(err) {
                if (err) _this.quit();
                return next(err);
              });
            } finally {
              resume();
              if (typeof callback === "function") callback();
            }
          });
        });
      });
    };

    RackApplication.prototype.restart = function(callback) {
      var _this = this;
      return this.quit(function() {
        return _this.ready(callback);
      });
    };

    RackApplication.prototype.restartIfNecessary = function(callback) {
      var _this = this;
      return this.queryRestartFile(function(mtimeChanged) {
        if (mtimeChanged) {
          return _this.restart(callback);
        } else {
          return callback();
        }
      });
    };

    return RackApplication;

  })();

}).call(this);
