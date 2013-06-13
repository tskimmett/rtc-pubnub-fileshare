var Connection = (function wrap() {
	function Connection(email, element, uuid, pubnub) {
		this.email = email;
		this.element = element;
		this.fileInput = element.querySelector("input");
		this.getButton = element.querySelector(".get");
		this.cancelButton = element.querySelector(".cancel");
		this.isInitiator = false;
		this.connected = false;
		this.shareStart = null;
		this.uuid = uuid;
		this.pubnub = pubnub;
		this.fileName = null;
		this.buffer = null;
		this.chunkSize = (IS_CHROME ? 800 : 50000);
		this.fileChunks = [];
		this.nChunksReceived = 0;
		this.nChunksExpected = 0;
		this.localIceCandidates = [];
		this.remoteIceCandidates = [];

		// Create event callbacks
		this.createPeerConnCallbacks();
		this.createChannelCallbacks();
		this.createUICallbacks();

		// Register UI events
		this.registerUIEvents();
	};

	Connection.prototype = {
		pcOpt: {
			optional: [
				{ RtpDataChannels: true }
			]
		},

		pcConfiguration: { iceServers: [{ url: (IS_CHROME ? 'stun:stun.l.google.com:19302' : 'stun:23.21.150.121') }] },

		offerShare: function () {
			console.log("Offering share...");
			this.isInitiator = true;

			/***
				-MUST create channel before createOffer
				-Chrome requires {reliable: false}
			***/
			var dict = {};
			if (window.webkitRTCPeerConnection) {
				dict.reliable = false;
			}
			if (!this.connected) {
				this.dataChannel = this.peerConn.createDataChannel('rtc-pubnub-fshare', dict);
				this.registerChannelEvents();

				this.peerConn.createOffer(this.onDescAvail.bind(this),
				function (err) {
					console.log("createOffer() failed: " + err);
				}, {});
			}
			else {
				console.log("Connection already established!");
			}
		},

		answerShare: function () {
			console.log("Answering share...");
			this.isInitiator = false;
			this.peerConn.createAnswer(this.onDescAvail.bind(this),
				function (err) {
					console.log("createAnswer() failed: " + err);
				}, {});
		},

		stageFileData: function (fName, fType, buffer) {
			this.fileName = fName;
			this.fileType = fType;
			this.buffer = buffer;
			var nChunks = Math.ceil(buffer.byteLength / this.chunkSize);
			this.fileChunks = new Array(nChunks);
			var start;
			for (var i = 0; i < nChunks; i++) {
				start = i * this.chunkSize;
				this.fileChunks[i] = buffer.slice(start, start + this.chunkSize);
			}
			console.log("File data staged");
		},

		checkDownloadComplete: function () {
			return (this.nChunksExpected == this.nChunksReceived);
		},

		prepareFileDownload: function () {
			var blob = new Blob(this.fileChunks, { type: this.fileType });
			var link = document.querySelector("#download");
			link.href = window.URL.createObjectURL(blob);
			link.download = this.fileName;
			link.click();
		},

		send: function (data) {
			this.dataChannel.send(data);
		},

		packageChunk: function (chunkId) {
			return JSON.stringify({
				action: protocol.DATA,
				id: chunkId,
				content: Base64Binary.encode(this.fileChunks[chunkId])
			});
		},

		requestChunk: function (chunkId) {
			console.log("Request chunk " + chunkId);
			var req = JSON.stringify({
				action: "REQ",
				id: chunkId
			});
			this.send(req);
		},

		transformOutgoingSdp: function (sdp) {
			var splitted = sdp.split("b=AS:30");
			var newSDP = splitted[0] + "b=AS:1638400" + splitted[1];
			return newSDP;
		},

		receiveDesc: function (msg) {
			var self = this;
			var desc = msg.desc;
			console.log(desc.type + " received.");
			this.peerConn.setRemoteDescription(new RTCSessionDescription(desc), function () {
				console.log("remoteDescription set");
				console.log(self.peerConn.remoteDescription);
				for (var i in self.remoteIceCandidates) {
					self.peerConn.addIceCandidate(self.remoteIceCandidates[i]);
				}
				if (desc.type == protocol.OFFER) {
					// Someone is ready to send file data. Let user opt-in to receive file data
					self.getButton.removeAttribute("disabled");
					self.cancelButton.removeAttribute("disabled");
					self.fileInput.disabled = "disabled";
					self.fileName = msg.fName;
					self.fileType = msg.fType;
					self.nChunksExpected = msg.nChunks;
					self.getButton.innerHTML = "Get File: " + self.fileName;
				}
				else if (desc.type == protocol.ANSWER) {
					// Someone is ready to receive my data.
					self.fileInput.setAttribute("disabled", "disabled");
				}
			}, function (err) {
				console.log("Could not setRemoteDescription: " + JSON.stringify(err));
				self.pubnub.publish({
					channel: protocol.CHANNEL,
					message: {
						uuid: self.uuid,
						action: protocol.ERR_REJECT
					}
				});
				self.reset();
			});
		},

		receiveICE: function (candidate) {
			var candidate = new RTCIceCandidate(candidate);
			this.remoteIceCandidates.push(candidate);
			if (this.peerConn.remoteDescription) {
				this.peerConn.addIceCandidate(candidate);
			}
		},

		handleSignal: function(msg) {
			if (msg.action === protocol.ERR_REJECT) {
				alert("Unable to communicate with " + this.email);
				this.reset();
			}
			else if (msg.action === protocol.CANCEL) {
				alert(this.email + " cancelled the share.");
				this.reset();
			}
		},

		handlePresence: function (msg) {
			if (msg.action === "join") {
				this.available = true;
				this.element.setAttribute("data-available", "true");
				this.fileInput.removeAttribute("disabled");
				if (!this.peerConn) {
					this.peerConn = new RTCPeerConnection(this.pcConfiguration, (IS_CHROME ? this.pcOpt : {}));
					this.registerPeerConnEvents();
				}
				var j = $(this.element);
				j.prependTo(j.parent());
			}
			else {
				this.available = false;
				this.element.setAttribute("data-available", "false");
				this.fileInput.disabled = "disabled";
				if (this.connected) {
					alert(this.email + " has canceled the share.");
					this.reset();
				}
			}
		},

		createPeerConnCallbacks: function () {
			var self = this;
			this.iceCallback = function (e) {
				//console.log("Local ICE candidate found.");
				self.pubnub.publish({
					channel: protocol.CHANNEL,
					message: {
						uuid: self.uuid,
						candidate: e.candidate
					}
				});
			};
			this.dataChannelCreated = function (e) {
				console.log("Data channel created by remote peer.");
				self.dataChannel = e.channel;
				self.registerChannelEvents();
			};
			this.onDescAvail = function (sessionDesc) {
				console.log("My session description is now available. Sending over wire.");
				/***
					CHROME HACK TO GET AROUND BANDWIDTH ISSUES
				 ***/
				sessionDesc.sdp = this.transformOutgoingSdp(sessionDesc.sdp);

				// Set the peer connection's local session description
				self.peerConn.setLocalDescription(sessionDesc, function () {
					console.log("localDescription set");
				}, function (err) {
					console.log("Could not set localDescription: " + err);
				});
				self.cancelButton.removeAttribute("disabled");
				self.connected = true;
				// Send session description over wire via PubNub
				self.pubnub.publish({
					channel: protocol.CHANNEL,
					message: {
						uuid: self.uuid,
						desc: sessionDesc,
						fName: self.fileName,
						fType: self.fileType,
						nChunks: self.fileChunks.length
					}
				});
			};
		},

		registerPeerConnEvents: function () {
			this.peerConn.onicecandidate = this.iceCallback.bind(this);
			this.peerConn.ondatachannel = this.dataChannelCreated.bind(this);
			console.log("PeerConnection events registered.");
		},

		createChannelCallbacks: function () {
			var self = this;
			this.onChannelMessage = function (msg) {
				//console.log("vvv DataChannel msg vvv");
				//console.log(msg);
				var data = JSON.parse(msg.data);
				if (data.action === protocol.DATA) {
					clearTimeout(this.reqTimeout);
					if (!self.fileChunks[data.id]) {
						self.fileChunks[data.id] = Base64Binary.decode(data.content);
						self.nChunksReceived++;
						if (!self.checkDownloadComplete()) {
							//self.requestChunk(data.id + 1);
						}
						else {
							console.log("Last chunk received.");
							self.send(JSON.stringify({ action: protocol.DONE }));
							self.prepareFileDownload();
							self.connected = false;
							self.reset();
						}
					}
				}
				else if (data.action === protocol.REQUEST) {
					console.log("Peer requesting chunk " + data.id);
					self.send(self.packageChunk(data.id));
				}
				else if (data.action === protocol.DONE) {
					self.connected = false;
					self.dataChannel.close();
					self.reset();
					alert("Share took " + ((Date.now() - self.shareStart) / 1000) + " seconds");
				}
			};

			this.onChannelReadyStateChange = function (e) {
				console.log("Channel state: " + e.type);
				if (e.type == "open") {
					if (self.isInitiator) {
						console.log("Sending packets now...");
						// Ready to communicate data now
						self.shareStart = Date.now();
						for (var chunk in self.fileChunks) {
							self.send(self.packageChunk(chunk));
						}
					}
				}
				else if (e.type === "closed" || e.type === "error" && self.connected) {
					alert("A communication error occurred. Sorry.");
					self.reset();
				}
			};
		},

		registerChannelEvents: function () {
			this.dataChannel.onmessage = this.onChannelMessage;
			this.dataChannel.onopen = this.onChannelReadyStateChange;
			this.dataChannel.onclose = this.onChannelReadyStateChange;
			console.log("DataChannel events registered.");
		},

		createUICallbacks: function () {
			var self = this;
			this.filePicked = function (e) {
				var file = self.fileInput.files[0];
				if (file) {
					var reader = new FileReader();
					reader.onloadend = function (e) {
						if (reader.readyState == FileReader.DONE) {
							self.stageFileData(file.name, file.type, reader.result);
							self.fileInput.disabled = "disabled";
							self.getButton.disabled = "disabled";

							self.offerShare();
						}
					};
					reader.readAsArrayBuffer(file);
				}
			};
			this.shareAccepted = function (e) {
				// Once we're receiving data, we can't initiate anymore streaming
				self.getButton.disabled = "disabled";
				self.fileInput.disabled = "disabled";

				self.answerShare();
				self.connected = true;
			};
			this.shareCancelled = function (e) {
				self.pubnub.publish({
					channel: protocol.CHANNEL,
					message: {
						uuid: self.uuid,
						action: protocol.CANCEL
					}
				});
				self.reset();
			};
		},

		registerUIEvents: function () {
			this.fileInput.onchange = this.filePicked;
			this.getButton.onclick = this.shareAccepted;
			this.cancelButton.onclick = this.shareCancelled;
		},

		reset: function () {
			if (this.available) {
				this.fileInput.removeAttribute("disabled");
			}
			this.fileInput.value = "";
			this.getButton.disabled = "disabled";
			this.cancelButton.disabled = "disabled";
			this.getButton.innerHTML = "Get File";
			this.isInitiator = false;
			this.connected = false;
			this.fileName = null;
			this.buffer = null;
			this.fileChunks = [];
			this.nChunksReceived = 0;
			this.nChunksExpected = 0;
			delete this.dataChannel;
			this.peerConn.close();
			delete this.peerConn;
			this.localIceCandidates = [];
			this.remoteIceCandidates = [];
			this.peerConn = new RTCPeerConnection(this.pcConfiguration, (IS_CHROME ? this.pcOpt : {}));
			this.registerPeerConnEvents();
		}

	}

	return Connection;
})();