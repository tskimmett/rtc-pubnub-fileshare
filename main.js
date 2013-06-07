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
	this.buffer = null;
	this.peerConn = new RTCPeerConnection(null);
	this.peerConn.onicecandidate = this.iceCallback;

	pubnub.subscribe({
		channel: CHANNEL,
		callback: this.handleSignal.bind(this)
	});
};

FSClient.prototype = {
	offerShare: function () {
		this.isInitiator = true;
		this.peerConn.createOffer(this.onDescAvail.bind(this),
			function (err) {
				console.log("createOffer() failed: " + err);
			}, {});
	},

	answerShare: function () {
		this.isInitiator = false;
		this.peerConn.createAnswer(this.onDescAvail.bind(this),
			function (err) {
				console.log("createOffer() failed: " + err);
			}, {});
	},

	onDescAvail: function (sessionDesc) {
		// Set the peer connection's local session description
		this.peerConn.setLocalDescription(sessionDesc, function () {
			console.log("Set localDescription successful!");
		}, function (err) {
			console.log("Could not set localDescription: " + err);
		});

		// Send session description over wire via PubNub
		// If we are the source, then the message indicates we are ready to send.
		// Otherwise it indicates we are ready to receive data.
		pubnub.publish({
			channel: CHANNEL,
			message: {
				uuid: this.uuid,
				desc: sessionDesc
			}
		});
	},

	stageFileData: function (buffer) {
		console.log("File data staged.");
		this.buffer = buffer;
		document.querySelector("#shareFile").disabled = "";
	},

	handleSignal: function (msg) {
		console.log(msg);
		// Don't care about messages we send
		if (msg.uuid != this.uuid && msg.desc) {
			var desc = msg.desc;
			console.log("Received " + desc.type + " message");
			this.peerConn.setRemoteDescription(new RTCSessionDescription(desc), function () {
				console.log("setRemoteDescription successful!");
			}, function (err) {
				console.log("Could not setRemoteDescription: " + err);
			});
			if (desc.type == OFFER) {
				// Someone is ready to send file data. Let user opt-in to receive file data
				document.querySelector("#getFile").removeAttribute("disabled");
			}
			else if (desc.type == ANSWER) {
				// Someone is ready to receive my data.
				
			}
		}
	}
};

var client = new FSClient();

document.onready = function () {
	var fInput = document.querySelector("#fileInput");
	fInput.onchange = function (e) {
		var file = fInput.files[0];
		if (file) {
			var reader = new FileReader();
			reader.onloadend = function (e) {
				if (reader.readyState == FileReader.DONE) {
					client.stageFileData(file.result);
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