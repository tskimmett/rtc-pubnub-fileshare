(function (window, PUBNUB) {
  //"use strict";

  // Remove vendor prefixes
  var IS_CHROME = !!window.webkitRTCPeerConnection;

  if (IS_CHROME) {
    window.RTCPeerConnection = webkitRTCPeerConnection;
    //RTCIceCandidate = webkitRTCIceCandidate;
    //RTCSessionDescription = webkitRTCSessionDescription;
  }
  else {
    window.RTCPeerConnection = mozRTCPeerConnection;
    window.RTCIceCandidate = mozRTCIceCandidate;
    window.RTCSessionDescription = mozRTCSessionDescription;
  }

  // Global error handling function
  function error(message) {
    console['error'](message);
  }

  // Global info logging
  var isDebug = true;
  function debug() {
    if (isDebug === true) {
      console['log'].apply(console, arguments);
    }
  }

  // Extend function for adding to existing objects
  function extend(obj, other) {
    for(var key in other) {
      obj[key] = other[key];
    }
    return obj;
  }

  // Putting UUID function here to work around non-exposed ID issues.
  function generateUUID() {
    var u = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
    function(c) {
        var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
    return u;
  }

  function extendAPI(PUBNUB, uuid) {
    // Store out API so we can extend it on all instances.
    var API = {},
        PREFIX = "pn_",               // Prefix for subscribe channels
        PEER_CONNECTIONS = {},        // Connection storage by uuid
        RTC_CONFIGURATION = null,     // Global config for RTC's
		    PC_OPTIONS = (IS_CHROME ? {
		      optional: [
				  { RtpDataChannels: true }
		      ]
		    } : {}),
        UUID = uuid,                  // The current user's UUID
        PUBLISH_QUEUE = {},           // The queue of messages to send by UUID
        PUBLISH_TYPE = {              // Publish type enum
          STREAM: 1,
          MESSAGE: 2
        };

    // Expose PUBNUB UUID (Need to fix this in core)
    PUBNUB['UUID'] = uuid;

    // SignalingChannel
    // The signaling channel handles sending data to and from a specific user channel.
    function SignalingChannel(pubnub, selfUuid, otherUuid) {
      this.selfUuid = selfUuid;
      this.otherUuid = otherUuid;
      // The send function is here so we do not count a reference to PubNub preventing its destruction.
      this.send = function (message) {
        message.uuid = selfUuid;
        message = JSON.stringify(message);
        debug("Sending", message, otherUuid);
        pubnub.publish({
          channel: PREFIX + otherUuid,
          message: message
        });
      };
    }

    function personalChannelCallback(message) {
      message = JSON.parse(message);
      debug("Got message", message);
      
      if (message.uuid != null) {
        var connected = PEER_CONNECTIONS[message.uuid] != null;

        // Setup the connection if we do not have one already.
        if (connected === false) {
          PUBNUB.createP2PConnection(message.uuid, false);
        }

        var connection = PEER_CONNECTIONS[message.uuid];

        if (message.sdp != null) {
          connection.connection.setRemoteDescription(new RTCSessionDescription(message.sdp), function () {

            // Add ice candidates we might have gotten early.
            for (var i = 0; i < connection.candidates; i++) {
              connection.connection.addIceCandidate(new RTCIceCandidate(connection.candidates[i]));
              connection.candidates = [];
            }

            // If we did not create the offer then create the answer.
            if (connected === false) {
              connection.connection.createAnswer(function (description) {
                PUBNUB.gotDescription(description, connection);
              }, function (err) {
                error(err);
              });
            }
          }, function (err) {
            // Maybe notify the peer that we can't communicate
            error("Error setting remote description: " + err.message);
          });
        } else {
          if (connection.connection.remoteDescription != null && connection.connection.iceConnectionState !== "connected") {
            connection.connection.addIceCandidate(new RTCIceCandidate(message.candidate));
          } else {
            // This is to prevent adding ice candidates before the remote description
            connection.candidates.push(message.candidate);
          }
        }
      }
    }

    // Subscribe to our own personal channel to listen for data.
    debug("Subscribing to personal channel");
    PUBNUB.subscribe({
      channel: PREFIX + uuid,
      connect: function (event) {
        PUBNUB.history({
          count: 1000,
          channel: PREFIX + uuid,
          callback: function (message) {
            debug("History:", message);
            var messages = message[0];
            for (var i = 0; i < messages.length; i++) {
              personalChannelCallback(messages[i]);
            }
          }
        });
      },
      callback: personalChannelCallback
    });

    // PUBNUB._gotDescription
    // This is the handler for when we get a SDP description from the WebRTC API.
    API['gotDescription'] = function (description, connection) {
      connection.connection.setLocalDescription(description);
      debug("Sending description", connection.signalingChannel);
      connection.signalingChannel.send({
        "sdp": description
      });
    };

    // PUBNUB.createP2PConnection
    // Signals and creates a P2P connection between two users.
    API['createP2PConnection'] = function (uuid, offer) {
      if (PEER_CONNECTIONS[uuid] == null) {
        var pc = new RTCPeerConnection(RTC_CONFIGURATION, PC_OPTIONS),
            signalingChannel = new SignalingChannel(this, UUID, uuid),
            self = this;

        function onDataChannelCreated(event) {
          PEER_CONNECTIONS[uuid].dataChannel = event.channel;

          PEER_CONNECTIONS[uuid].dataChannel.onmessage = function (event) {
            debug("Got data channel message", event.data);
            if (PEER_CONNECTIONS[uuid].callback) {
              PEER_CONNECTIONS[uuid].callback(event.data, event);
            } else {
              // Store it in the history so the user can still get to it
              PEER_CONNECTIONS[uuid].history.push(event.data);
            }
          };

          event.channel.onopen = function (event) {
            debug("Connection state changed", event);
            PEER_CONNECTIONS[uuid].connected = true;
            self._peerPublish(uuid);
          };
        }
        pc.ondatachannel = onDataChannelCreated;

        pc.onicecandidate = function (event) {
          // TODO: Figure out why we get a null candidate
          if (event.candidate != null) {
            signalingChannel.send({ "candidate": event.candidate });
          }
        };

        pc.oniceconnectionstatechange = function (event) {
          if (pc.iceConnectionState === "connected") {
            // Nothing for now
          }
        };

        PUBLISH_QUEUE[uuid] = [];

        PEER_CONNECTIONS[uuid] = {
          stream: null,
          callback: null,
          connection: pc,
          candidates: [],
          connected: false,
          signalingChannel: signalingChannel,
          history: []
        };

        if (offer !== false) {
          var dc = pc.createDataChannel("pubnub", { reliable: false });
          onDataChannelCreated({
            channel: dc
          });

          pc.createOffer(function (description) {
            self.gotDescription(description, PEER_CONNECTIONS[uuid]);
          }, function (err) {
            error(err);
          });
        }
      } else {
        debug("Trying to connect to already connected user: " + uuid);
      }
    };

    // Helper function for sending messages with different types.
    function handleMessage(connection, message) {
      if (message.type === PUBLISH_TYPE.STREAM) {
        connection.connection.addStream(message.stream);
      } else if (message.type === PUBLISH_TYPE.MESSAGE) {
        connection.dataChannel.send(message.message);
      } else {
        error("Unrecognized RTC message type: " + message.type);
      }
    }

    // PUBNUB._peerPublish
    // Handles requesting a peer connection and emptying the queue when connected.
    API['_peerPublish'] = function (uuid) {
      if (PUBLISH_QUEUE[uuid] && PUBLISH_QUEUE[uuid].length > 0) {
        if (PEER_CONNECTIONS[uuid].connected === true) {
          handleMessage(PEER_CONNECTIONS[uuid], PUBLISH_QUEUE[uuid].shift());
          this._peerPublish(uuid);
        } else {
          // Not connected yet so just sit tight!
        }
      } else {
        // Nothing to publish
        return;
      }
    };

    // PUBNUB.publish overload
    API['publish'] = (function (_super) {
      return function (options) {
        if (options == null) {
          error("You must send an object when using PUBNUB.publish!");
        }

        if (options.user != null) {
          if (options.stream != null) {
            PUBLISH_QUEUE[options.user].push({
              type: PUBLISH_TYPE.STREAM,
              stream: options.stream
            });
            //PEER_CONNECTIONS[options.user].connection.addStream(options.stream);
          } else if (options.message != null) {
            PUBLISH_QUEUE[options.user].push({
              type: PUBLISH_TYPE.MESSAGE,
              message: options.message
            });
            //PEER_CONNECTIONS[options.user].dataChannel.send(options.message);
          } else {
            error("Stream or message key not found in argument object. One or the other must be provided for RTC publish calls!");
          }

          this._peerPublish(options.user);
        } else {
          _super.apply(this, arguments);
        }
      };
    })(PUBNUB['publish']);

    // PUBNUB.subscribe overload
    API['subscribe'] = (function (_super) {
      return function (options) {
        if (options == null) {
          error("You must send an object when using PUBNUB.subscribe!");
        }

        if (options.user != null) {
          var connection = PEER_CONNECTIONS[options.user];
          debug(PEER_CONNECTIONS, options.user, connection);

          if (options.stream) {
            // Setup the stream added listener
            connection.stream = options.stream;
            connection.connection.onaddstream = function (event) {
              if (connection.stream) {
                connection.stream(event.stream, event);
              }
            };
          }

          if (options.callback) {
            // Setup the data channel callback listener
            connection.callback = options.callback;
          }
        } else {
          _super.apply(this, arguments);
        }
      };
    })(PUBNUB['subscribe']);

    // PUBNUB.history overload
    API['history'] = (function (_super) {
      return function (options) {
        if (options == null) {
          error("You must send an object when using PUBNUB.history!");
        }

        if (options.user != null) {
          if (options.callback) {
            var history = PEER_CONNECTIONS[options.user].history;

            options.callback([history]);
          } else {
            error("No callback provided for PUBNUB.history");
          }
        } else {
          return _super.apply(this, arguments);
        }
      };
    })(PUBNUB['history']);

    return extend(PUBNUB, API);
  }

  // PUBNUB init overload
  PUBNUB['init'] = (function (_super) {
    return function (options) {
      // Grab the UUID
      var uuid = options.uuid || generateUUID();
      options.uuid = uuid;

      // Create pubnub object
      debug(options);
      var pubnub = _super.call(this, options);

      // Extend the WebRTC API
      pubnub = extendAPI(pubnub, uuid);
      return pubnub;
    };
  })(PUBNUB['init']);

  //extend(PUBNUB, API);

  // Also initialize the global PUBNUB object
  //initialize.call(PUBNUB);

})(window, PUBNUB);