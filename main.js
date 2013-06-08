var CHANNEL = "get-my-file";
var OFFER = "offer";
var ANSWER = "answer";

var pubnub = PUBNUB.init({
	publish_key: 'pub-c-b2d901ee-2a0f-4d89-8cd3-63039aa6dd90',
	subscribe_key: 'sub-c-c74c7cd8-cc8b-11e2-a2ac-02ee2ddab7fe'
});

function FSClient() {
	this.isInitiator = false;
	this.uuid = pubnub.uuid();
	this.fileName = null;
	this.buffer = null;
	this.chunkSize = 800;
	this.fileChunks = [];
	this.nChunksReceived = 0;
	this.nChunksExpected = 0;
	this.localIceCandidates = [];
	this.remoteIceCandidates = [];
	var configuration = { 'iceServers': [{ 'url': 'stun:stun.l.google.com:19302' }] };
	this.peerConn = new webkitRTCPeerConnection(configuration, {
		optional: [
			{ RtpDataChannels: true }
		]
	});

	// Create event callbacks
	this.createPeerConnCallbacks();
	this.createChannelCallbacks();

	// Register PC events
	this.registerPeerConnEvents();

	pubnub.subscribe({
		channel: CHANNEL,
		callback: this.handleSignal.bind(this)
	});
};

FSClient.prototype = {
	offerShare: function () {
		console.log("Offering share...");
		this.isInitiator = true;

		this.dataChannel = this.peerConn.createDataChannel('RTCDataChannel', { reliable: false });
		this.registerChannelEvents();

		this.peerConn.createOffer(this.onDescAvail.bind(this),
			function (err) {
				console.log("createOffer() failed: " + err);
			}, {});
	},

	answerShare: function () {
		console.log("Answering share...");
		this.isInitiator = false;
		this.peerConn.createAnswer(this.onDescAvail.bind(this),
			function (err) {
				console.log("createAnswer() failed: " + err);
			}, {});
	},

	createPeerConnCallbacks: function () {
		var self = this;
		this.iceCallback = function (e) {
			//console.log("Local ICE candidate found.");
			pubnub.publish({
				channel: CHANNEL,
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
			// Set the peer connection's local session description
			self.peerConn.setLocalDescription(sessionDesc, function () {
				console.log("localDescription set");
			}, function (err) {
				console.log("Could not set localDescription: " + err);
			});

			// Send session description over wire via PubNub
			pubnub.publish({
				channel: CHANNEL,
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
			setTimeout(function (msg) {
				console.log("vvv DataChannel msg vvv");
				console.log(msg);
				var data = JSON.parse(msg.data);
				if (!isNaN(data.id)) {
					self.fileChunks[data.id] = Base64Binary.decode(data.content);
					self.nChunksReceived++;
					if (!self.checkDownloadComplete()) {
						self.send(JSON.stringify({
							ack: data.id + 1
						}));
					}
					else {
						console.log("Last chunk received.");
						self.prepareFileDownload();
					}
				}
				else if (!isNaN(data.ack)) {
					console.log("Peer requesting chunk " + data.ack);
					self.send(self.packageChunk(data.ack));
				}
			}.bind(self, msg), 200);
		};

		this.onChannelReadyStateChange = function (e) {
			console.log("Channel state: " + e.type);
			if (e.type == "open") {
				if (self.isInitiator) {
					// Ready to communicate data now
					self.beginDataTransfer();
				}
			}
		};
	},

	registerChannelEvents: function () {
		this.dataChannel.onmessage = this.onChannelMessage;
		this.dataChannel.onopen = this.onChannelReadyStateChange;
		this.dataChannel.onclose = this.onChannelReadyStateChange;
		console.log("DataChannel events registered.");
	},

	stageFileData: function (fName, fType, buffer) {
		this.buffer = buffer;
		var nChunks = Math.ceil(buffer.byteLength / this.chunkSize);
		this.fileChunks = new Array(nChunks);
		var start;
		for (var i = 0; i < nChunks; i++) {
			start = i * this.chunkSize;
			this.fileChunks[i] = buffer.slice(start, start + this.chunkSize);
		}
		this.fileName = fName;
		this.fileType = fType;
		document.querySelector("#shareFile").disabled = "";
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

	beginDataTransfer: function () {
		var self = this;
		console.log("Begin data transfer...");
		// Send each chunk over the channel
		this.send(this.packageChunk(0));
	},

	send: function (data) {
		this.dataChannel.send(data);
	},

	packageChunk: function (chunkId) {
		return JSON.stringify({
			id: chunkId,
			content: Base64Binary.encode(this.fileChunks[chunkId])
		});
	},

	handleSignal: function (msg) {
		var self = this;
		//console.log(msg);
		// Don't care about messages we send
		if (msg.uuid !== this.uuid) {
			if (msg.desc) {
				var desc = msg.desc;
				console.log(desc.type + " received.");
				this.peerConn.setRemoteDescription(new RTCSessionDescription(desc), function () {
					console.log("remoteDescription set");
					console.log(self.peerConn.remoteDescription);
					for (var i in self.remoteIceCandidates) {
						self.peerConn.addIceCandidate(self.remoteIceCandidates[i]);
					}
				}, function (err) {
					console.log("Could not setRemoteDescription: " + err);
				});
				if (desc.type == OFFER) {
					// Someone is ready to send file data. Let user opt-in to receive file data
					var gfButton = document.querySelector("#getFile");
					gfButton.removeAttribute("disabled");
					this.fileName = msg.fName;
					this.fileType = msg.fType;
					this.nChunksExpected = msg.nChunks;
					gfButton.innerHTML = "Get File: " + this.fileName;
				}
				else if (desc.type == ANSWER) {
					// Someone is ready to receive my data.
					document.querySelector("#shareFile").disabled = "disabled";
				}
			}
			else if (msg.candidate) {
				var candidate = new RTCIceCandidate(msg.candidate);
				this.remoteIceCandidates.push(candidate);
				if (this.peerConn.remoteDescription) {
					this.peerConn.addIceCandidate(candidate);
				}
			}
		}
	}
};

var client = new FSClient();

document.onready = function () {
	var fInput = document.querySelector("#fileInput");
	var file;
	fInput.onchange = function (e) {
		file = fInput.files[0];
		if (file) {
			var reader = new FileReader();
			reader.onloadend = function (e) {
				if (reader.readyState == FileReader.DONE) {
					client.stageFileData(file.name, file.type, reader.result);
				}
			};
			reader.readAsArrayBuffer(file);
		}
	};

	var gfButton = document.querySelector("#getFile");
	gfButton.onclick = function (e) {
		// Once we're receiving data, we can't initiate anymore streaming
		gfButton.disabled = "disabled";
		fInput.disabled = "disabled";

		client.answerShare();
	};

	var sfButton = document.querySelector("#shareFile");
	sfButton.onclick = function (e) {
		// Once we're sending data, we can't initiate anymore sharing
		fInput.disabled = "disabled";
		sfButton.disabled = "disabled";

		client.offerShare();
	};
};