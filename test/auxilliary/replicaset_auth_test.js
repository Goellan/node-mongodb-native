var mongodb = process.env['TEST_NATIVE'] != null ? require('../../lib/mongodb').native() : require('../../lib/mongodb').pure();

var testCase = require('nodeunit').testCase,
  debug = require('util').debug,
  inspect = require('util').inspect,
  nodeunit = require('nodeunit'),
  gleak = require('../../dev/tools/gleak'),
  Db = mongodb.Db,
  Cursor = mongodb.Cursor,
  Collection = mongodb.Collection,
  Server = mongodb.Server,
  ReplSetServers = mongodb.ReplSetServers,
  ReplicaSetManager = require('../../test/tools/replica_set_manager').ReplicaSetManager,
  Step = require("step");

var MONGODB = 'integration_tests';
var serverManager = null;
var RS = RS == null ? null : RS;

/**
 * Retrieve the server information for the current
 * instance of the db client
 *
 * @ignore
 */
exports.setUp = function(callback) {
  RS = new ReplicaSetManager({retries:120,
    auth:true,
    arbiter_count:0,
    secondary_count:1,
    passive_count:0});
  RS.startSet(true, function(err, result) {
    if(err != null) throw err;
    // Finish setup
    callback();
  });
}

/**
 * Retrieve the server information for the current
 * instance of the db client
 *
 * @ignore
 */
exports.tearDown = function(callback) {
  callback();
}

exports.shouldCorrectlyAuthenticateWithMultipleLoginsAndLogouts = function(test) {
  var replSet = new ReplSetServers( [
      new Server( RS.host, RS.ports[1], { auto_reconnect: true } ),
      new Server( RS.host, RS.ports[0], { auto_reconnect: true } ),
    ],
    {rs_name:RS.name}
  );

  // Connect to the replicaset
  var slaveDb = null;
  var db = new Db('foo', replSet, {native_parser: (process.env['TEST_NATIVE'] != null)});
  db.open(function(err, p_db) {
    Step(
      function addUser() {
        db.admin().addUser("me", "secret", this);
      },

      function ensureFailingInsert(err, result) {
        // return
        var self = this;
        test.equal(null, err);
        test.ok(result != null);

        db.collection("stuff", function(err, collection) {
          collection.insert({a:2}, {safe: {w: 3}}, self);
        });
      },

      function authenticate(err, result) {
        test.ok(err != null);

        db.admin().authenticate("me", "secret", this);
      },

      function changePassword(err, result) {
        var self = this;
        test.equal(null, err);
        test.ok(result);

        db.admin().addUser("me", "secret2", this);
      },

      function authenticate(err, result) {
        db.admin().authenticate("me", "secret2", this);
      },

      function insertShouldSuccedNow(err, result) {
        var self = this;
        test.equal(null, err);
        test.ok(result);

        db.collection("stuff", function(err, collection) {
          collection.insert({a:3}, {safe: true}, self);
        });
      },

      function queryShouldExecuteCorrectly(err, result) {
        var self = this;
        test.equal(null, err);

        db.collection("stuff", function(err, collection) {
          collection.findOne(self);
        });
      },

      function logout(err, item) {
        test.ok(err == null);
        test.equal(3, item.a);

        db.admin().logout(this);
      },

      function findShouldFailDueToLoggedOut(err, result) {
        var self = this;
        test.equal(null, err);

        db.collection("stuff", function(err, collection) {
          collection.findOne(self);
        });
      },

      function sameShouldApplyToRandomSecondaryServer(err, result) {
        var self = this;
        test.ok(err != null);

        slaveDb = new Db('foo', new Server(db.serverConfig.secondaries[0].host
                  , db.serverConfig.secondaries[0].port, {auto_reconnect: true, poolSize: 1}), {native_parser: (process.env['TEST_NATIVE'] != null), slave_ok:true});
        slaveDb.open(function(err, slaveDb) {
          slaveDb.collection('stuff', function(err, collection) {
            collection.findOne(self)
          })
        });
      },

      function shouldCorrectlyAuthenticateAgainstSecondary(err, result) {
        test.ok(err != null)
        slaveDb.admin().authenticate('me', 'secret2', this);
      },

      function shouldCorrectlyInsertItem(err, result) {
        var self = this;
        test.equal(null, err);
        test.ok(result);

        slaveDb.collection('stuff', function(err, collection) {
          collection.findOne(self)
        })
      },

      function finishUp(err, item) {
        test.ok(err == null);
        test.equal(3, item.a);

        test.done();
        p_db.close();
        slaveDb.close();
      }
    )
  });
}

exports.shouldCorrectlyAuthenticate = function(test) {
  var replSet = new ReplSetServers( [
      new Server( RS.host, RS.ports[1], { auto_reconnect: true } ),
      new Server( RS.host, RS.ports[0], { auto_reconnect: true } ),
    ],
    {rs_name:RS.name, read_secondary:true}
  );

  // Connect to the replicaset
  var slaveDb = null;
  var db = new Db('foo', replSet, {native_parser: (process.env['TEST_NATIVE'] != null)});
  db.open(function(err, p_db) {
    Step(
      function addUser() {
        db.admin().addUser("me", "secret", this);
      },

      function ensureFailingInsert(err, result) {
        var self = this;
        test.equal(null, err);
        test.ok(result != null);

        db.collection("stuff", function(err, collection) {
          collection.insert({a:2}, {safe: {w: 2, wtimeout: 10000}}, self);
        });
      },

      function authenticate(err, result) {
        test.ok(err != null);

        db.admin().authenticate("me", "secret", this);
      },

      function insertShouldSuccedNow(err, result) {
        var self = this;
        test.equal(null, err);
        test.ok(result);

        db.collection("stuff", function(err, collection) {
          collection.insert({a:2}, {safe: {w: 2, wtimeout: 10000}}, self);
        });
      },

      function queryShouldExecuteCorrectly(err, result) {
        var self = this;
        test.equal(null, err);

        db.collection("stuff", function(err, collection) {
          collection.findOne(self);
        });
      },

      function finishUp(err, item) {
        test.ok(err == null);
        test.equal(2, item.a);
        test.done();
        p_db.close();
      }
    )
  });
}

exports.shouldCorrectlyAuthenticateAndEnsureIndex = function(test) {
  var replSet = new ReplSetServers( [
      new Server( RS.host, RS.ports[0], { auto_reconnect: true } ),
      new Server( RS.host, RS.ports[0], { auto_reconnect: true } ),
    ],
    {rs_name:RS.name}
  );

  var db = new Db(MONGODB, replSet, {native_parser: false});
  db.open(function(err, db_p) {
    if (err){
      console.log('ERR:'+err);
      console.log('DB:'+db_p);
    }

    db_p.addUser('test', 'test', function(err, result) {
      if (err){
        console.log('ERR AUTH:'+err);
        console.log('replies:'+result);
      }

      db_p.authenticate('test', 'test', function(err, replies) {
        if (err){
          console.log('ERR AUTH:'+err);
          console.log('replies:'+replies);
        }

        db_p.collection('userconfirm', function( err, result ){
          if (err){
            console.log('Collection ERR:'+err);
          }

          var userconfirm = result;
          var ensureIndexOptions = { unique: true, safe: false, background: true };
          userconfirm.ensureIndex([ [ 'confirmcode', 1 ] ],ensureIndexOptions, function(err, item){

            if (err){
              console.log('Userconfirm ensure index failed:'+err);
            }

            db_p.collection('session', function( err, result ){
              if (err){
                console.log('Collection SESSION ERR:'+err);
              }

              var session = result;
              session.ensureIndex([ [ 'sid', 1 ] ],ensureIndexOptions, function(err, res){
                if(err){
                  console.log('Session ensure index failed'+err);
                }

                db_p.close();
                test.done();
              });
            });
          });
        });
      });
    });
  });
}

/**
 * Retrieve the server information for the current
 * instance of the db client
 *
 * @ignore
 */
exports.noGlobalsLeaked = function(test) {
  var leaks = gleak.detectNew();
  test.equal(0, leaks.length, "global var leak detected: " + leaks.join(', '));
  test.done();
}