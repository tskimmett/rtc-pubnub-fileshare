document.addEventListener("DOMContentLoaded", function () {
	var protocol = {
		CHANNEL: "get-my-file",
		OFFER: "offer",
		ANSWER: "answer",
		REQUEST: "req-chunk",
		DATA: "data",
		DONE: "done"
	};

	var CONTACT_API_URL = "https://www.google.com/m8/feeds";
	var IS_CHROME = !!window.webkitRTCPeerConnection;

	if (IS_CHROME) {
		RTCPeerConnection = webkitRTCPeerConnection;
		//RTCIceCandidate = webkitRTCIceCandidate;
		//RTCSessionDescription = webkitRTCSessionDescription;
	}
	else {
		RTCPeerConnection = mozRTCPeerConnection;
		RTCIceCandidate = mozRTCIceCandidate;
		RTCSessionDescription = mozRTCSessionDescription;
	}

	var pubnub;

	function FSClient() {
		this.isInitiator = false;
		this.shareStart = null;
		this.uuid = null;
		this.contacts = {};
		this.fileName = null;
		this.buffer = null;
		this.chunkSize = (IS_CHROME ? 800 : 50000);
		this.fileChunks = [];
		this.nChunksReceived = 0;
		this.nChunksExpected = 0;
		this.localIceCandidates = [];
		this.remoteIceCandidates = [];
		var configuration = { 'iceServers': [{ 'url': (IS_CHROME ? 'stun:stun.l.google.com:19302' : 'stun:23.21.150.121') }] };
		var opt = {
			optional: [
				{ RtpDataChannels: true }
			]
		};
		this.peerConn = new RTCPeerConnection(configuration, (IS_CHROME ? opt : {}));

		// Create event callbacks
		this.createPeerConnCallbacks();
		this.createChannelCallbacks();

		// Register PC events
		this.registerPeerConnEvents();
	};

	FSClient.prototype = {
		obtainGoogleToken: function () {
			// First, parse the query string
			var params = {}, queryString = location.hash.substring(1),
				regex = /([^&=]+)=([^&]*)/g, m;
			while (m = regex.exec(queryString)) {
				params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
			}

			if (params.access_token) {
				window.location.hash = "";
				this.token = params.access_token;
				//$.ajax({
				//	url: "https://www.googleapis.com/oauth2/v1/tokeninfo",
				//	data: {
				//		access_token: this.token
				//	}
				//}).done(function (res) {
				//	console.log(res);
				//});
				this.getContacts();
				return;
			}

			var params = {
				response_type: "token",
				client_id: "999382287610.apps.googleusercontent.com",
				redirect_uri: "http://localhost:27601/rtc-pubnub-fileshare/index.html",
				scope: CONTACT_API_URL
			};
			var query = [];
			for (var p in params) {
				query.push(p + "=" + encodeURIComponent(params[p]));
			}
			query = query.join("&");
			window.open("https://accounts.google.com/o/oauth2/auth?" + query, "_self");
		},

		getContacts: function () {
			var self = this;
			$.ajax({
				url: CONTACT_API_URL + "/contacts/default/full",
				type: "GET",
				data: {
					access_token: this.token,
					v: 3.0,
					alt: "json"
				}
			}).done(function (res) {
				console.log(res);
				self.uuid = res.feed.author[0].email["$t"];
				var contacts = res.feed.entry;
				contacts.forEach(function (e) {
					self.contacts[e["gd$email"][0].address] = {};
				});

				var template = _.template($("#contact-template").html().trim());
				for (var email in self.contacts) {
					var c = template({ email: email, available: false });
					console.log(c);
					$(".contact-list").append($(c));
				}

				pubnub = PUBNUB.init({
					publish_key: 'pub-c-b2d901ee-2a0f-4d89-8cd3-63039aa6dd90',
					subscribe_key: 'sub-c-c74c7cd8-cc8b-11e2-a2ac-02ee2ddab7fe',
					uuid: self.uuid
				});

				pubnub.subscribe({
					channel: protocol.CHANNEL,
					callback: self.handleSignal.bind(self),
					presence: self.handlePresence.bind(self)
				});
			});
		},

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
			this.dataChannel = this.peerConn.createDataChannel('rtc-pubnub-fshare', dict);
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

				// Send session description over wire via PubNub
				pubnub.publish({
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
						}
					}
				}
				else if (data.action === protocol.REQUEST) {
					console.log("Peer requesting chunk " + data.id);
					self.send(self.packageChunk(data.id));
				}
				else if (data.action === protocol.DONE) {
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
			};
		},

		registerChannelEvents: function () {
			this.dataChannel.onmessage = this.onChannelMessage;
			this.dataChannel.onopen = this.onChannelReadyStateChange;
			this.dataChannel.onclose = this.onChannelReadyStateChange;
			console.log("DataChannel events registered.");
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
			//this.reqTimeout = setTimeout(this.send.bind(this, req), this.reqTimeoutThreshold);
		},

		transformOutgoingSdp: function (sdp) {
			var splitted = sdp.split("b=AS:30");
			var newSDP = splitted[0] + "b=AS:1638400" + splitted[1];
			return newSDP;
		},

		/**
			"Signals" are sent via PubNub until the DataChannel is established
		**/
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
					if (desc.type == protocol.OFFER) {
						// Someone is ready to send file data. Let user opt-in to receive file data
						var gfButton = document.querySelector("#getFile");
						gfButton.removeAttribute("disabled");
						this.fileName = msg.fName;
						this.fileType = msg.fType;
						this.nChunksExpected = msg.nChunks;
						gfButton.innerHTML = "Get File: " + this.fileName;
					}
					else if (desc.type == protocol.ANSWER) {
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
		},

		handlePresence: function (msg) {
			console.log(msg);
			// Only care about presence messages from people in our Google contacts
			if (this.contacts[msg.uuid]) {
				if (msg.action === "join") {
					document.getElementById("contact-" + msg.uuid).setAttribute("data-available", "true");
				}
				else {
					document.getElementById("contact-" + msg.uuid).setAttribute("data-available", "false");
				}
			}
		}
	};

	var client = new FSClient();
	client.obtainGoogleToken();

	//var fInput = document.querySelector("#fileInput");
	//var file;
	//fInput.addEventListener("change", function (e) {
	//	file = fInput.files[0];
	//	if (file) {
	//		var reader = new FileReader();
	//		reader.onloadend = function (e) {
	//			if (reader.readyState == FileReader.DONE) {
	//				client.stageFileData(file.name, file.type, reader.result);
	//			}
	//		};
	//		reader.readAsArrayBuffer(file);
	//	}
	//});

	//var gfButton = document.querySelector("#getFile");
	//gfButton.addEventListener("click", function (e) {
	//	// Once we're receiving data, we can't initiate anymore streaming
	//	gfButton.disabled = "disabled";
	//	fInput.disabled = "disabled";

	//	client.answerShare();
	//}, false);

	//var sfButton = document.querySelector("#shareFile");
	//sfButton.addEventListener("click", function (e) {
	//	// Once we're sending data, we can't initiate anymore sharing
	//	fInput.disabled = "disabled";
	//	sfButton.disabled = "disabled";

	//	client.offerShare();
	//});
});;