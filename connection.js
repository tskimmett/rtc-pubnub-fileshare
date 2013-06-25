var Connection = (function wrap() {
    "use strict";

    var HOSTED = window.location.protocol !== "file:";
    var protocol = {
        CHANNEL: "get-my-file2",
        OFFER: "offer",
        ANSWER: "answer",
        REQUEST: "req-chunk",
        DATA: "data",
        DONE: "done",
        ERR_REJECT: "err-reject",
        CANCEL: "cancel"
    };
    var IS_CHROME = !!window.webkitRTCPeerConnection;
    var MAX_FSIZE = 200;    // MiB -- browser will crash when trying to bring more than that into memory

    function Connection(email, element, uuid, pubnub) {
        this.email = email;
        this.element = element;
        this.fileInput = element.querySelector("input");
        this.getButton = element.querySelector(".get");
        this.cancelButton = element.querySelector(".cancel");
        this.progress = element.querySelector(".progress");
        this.isInitiator = false;
        this.connected = false;
        this.shareStart = null;
        this.uuid = uuid;
        this.pubnub = pubnub;
        this.fileManager = new FileManager((IS_CHROME ? 800 : 50000));

        // Create event callbacks
        this.createChannelCallbacks();
        this.createUICallbacks();
        this.createFileCallbacks();

        // Register UI events
        this.registerUIEvents();

        // Progress bar init
        this.initProgress();

        this.registerFileEvents();
    };

    Connection.prototype = {
        offerShare: function () {
            console.log("Offering share...");
            this.isInitiator = true;

            this.connected = true;
            var msg = {
                uuid: this.uuid,
                target: this.email,
                fName: this.fileManager.fileName,
                fType: this.fileManager.fileType,
                nChunks: this.fileManager.fileChunks.length,
                action: protocol.OFFER
            };

            this.pubnub.publish({
                channel: protocol.CHANNEL,
                message: msg
            });
        },

        answerShare: function () {
            console.log("Answering share...");
            // Tell other person to join the P2P channel
            this.pubnub.publish({
                channel: protocol.CHANNEL,
                message: {
                    uuid: this.uuid,
                    target: this.email,
                    action: protocol.ANSWER
                }
            });
            this.p2pSetup();
            this.fileManager.requestChunks();
        },

        send: function (data) {
            this.pubnub.publish({
                user: this.email,
                message: data
            });
        },

        packageChunk: function (chunkId) {
            return JSON.stringify({
                action: protocol.DATA,
                id: chunkId,
                content: Base64Binary.encode(this.fileManager.fileChunks[chunkId])
            });
        },

        statusBlink: function (on) {
            var indicator = $(this.element.querySelector(".status"));
            if (!on) {
                clearInterval(this.blink);
                indicator.removeAttr("style");
                return;
            }
            var white = true;
            this.blink = setInterval(function () {
                indicator.css("background-color", (white ? "#EEEBE4" : "limegreen"));
                white = !white;
            }, 700);
        },

        handleSignal: function (msg) {
            //console.log(msg);
            if (msg.action === protocol.ANSWER) {
                console.log("THE OTHER PERSON IS READY");
                this.p2pSetup();
            }
            else if (msg.action === protocol.OFFER) {
                // Someone is ready to send file data. Let user opt-in to receive file data
                this.getButton.removeAttribute("disabled");
                this.cancelButton.removeAttribute("disabled");
                //this.fileInput.setAttribute("disabled", "disabled");
                $(this.fileInput).addClass("hidden");

                this.fileManager.stageRemoteFile(msg.fName, msg.fType, msg.nChunks);

                this.getButton.innerHTML = "Get: " + msg.fName;
                this.statusBlink(true);
            }
            else if (msg.action === protocol.ERR_REJECT) {
                alert("Unable to communicate with " + this.email);
                this.reset();
            }
            else if (msg.action === protocol.CANCEL) {
                alert(this.email + " cancelled the share.");
                this.reset();
            }
        },

        handlePresence: function (msg) {
            console.log("Connection handling presence msg: ", msg);
            if (msg.action === "join") {
                this.available = true;
                this.element.setAttribute("data-available", "true");
                this.fileInput.removeAttribute("disabled");
                $(this.fileInput).removeClass("hidden");

                var j = $(this.element);
                j.prependTo(j.parent());
            }
            else {
                this.available = false;
                this.statusBlink(false);
                this.element.setAttribute("data-available", "false");
                this.fileInput.setAttribute("disabled", "disabled");
                $(this.fileInput).addClass("hidden");
                if (this.connected) {
                    alert(this.email + " has canceled the share.");
                    this.reset();
                }
                var j = $(this.element);
                j.appendTo(j.parent());
            }
        },

        p2pSetup: function () {
            console.log("Setting up P2P...");
            this.pubnub.subscribe({
                user: this.email,
                callback: this.onChannelMessage
            });
            var self = this;
            this.pubnub.history({
                user: this.email,
                callback: function (messages) {
                    console.log("History: " + messages);
                    messages = messages[0];
                    messages.forEach(self.onChannelMessage);
                }
            });
            this.shareStart = Date.now();
        },

        createChannelCallbacks: function () {
            var self = this;
            this.onChannelMessage = function (data) {
                console.log("P2P message: ", data.action);
                if (data.action === protocol.DATA) {
                    self.fileManager.receiveChunk(data);
                }
                else if (data.action === protocol.REQUEST) {
                    self.nChunksSent += data.ids.length;
                    self.updateProgress(data.nReceived / self.fileManager.fileChunks.length);
                    data.ids.forEach(function (id) {
                        self.send(self.packageChunk(id));
                    });
                }
                else if (data.action === protocol.DONE) {
                    self.connected = false;
                    self.reset();
                    alert("Share took " + ((Date.now() - self.shareStart) / 1000) + " seconds");
                }
            };
        },

        createUICallbacks: function () {
            var self = this;
            this.filePicked = function (e) {
                var file = self.fileInput.files[0];
                if (file) {
                    var mbSize = file.size / (1024 * 1024);
                    if (mbSize > MAX_FSIZE) {
                        alert("Due to browser memory limitations, files greater than " + MAX_FSIZE + " MiB are unsupported. Your file is " + mbSize.toFixed(2) + " MiB.");
                        var newInput = document.createElement("input");
                        newInput.type = "file";
                        newInput.className = "share";
                        self.element.replaceChild(newInput, self.fileInput);
                        self.fileInput = newInput;
                        self.registerUIEvents();
                        return;
                    }
                    var reader = new FileReader();
                    reader.onloadend = function (e) {
                        if (reader.readyState == FileReader.DONE) {
                            self.fileManager.stageLocalFile(file.name, file.type, reader.result);
                            self.fileInput.setAttribute("disabled", "disabled");
                            self.getButton.setAttribute("disabled", "disabled");
                            self.cancelButton.removeAttribute("disabled");

                            self.offerShare();
                        }
                    };
                    reader.readAsArrayBuffer(file);
                }
            };
            this.shareAccepted = function (e) {
                // Once we're receiving data, we can't initiate anymore streaming
                self.getButton.setAttribute("disabled", "disabled");
                self.fileInput.setAttribute("disabled", "disabled");

                self.answerShare();
                self.statusBlink(false);
                self.connected = true;
            };
            this.shareCancelled = function (e) {
                self.pubnub.publish({
                    channel: protocol.CHANNEL,
                    message: {
                        uuid: self.uuid,
                        action: protocol.CANCEL,
                        target: self.email
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

        createFileCallbacks: function () {
            var self = this;
            this.chunkRequestReady = function (chunks) {
                console.log("Chunks ready: ", chunks.length);
                var req = JSON.stringify({
                    action: protocol.REQUEST,
                    ids: chunks,
                    nReceived: self.fileManager.nChunksReceived
                });
                self.send(req);
            };
            this.transferComplete = function () {
                console.log("Last chunk received.");
                self.send(JSON.stringify({ action: protocol.DONE }));
                self.fileManager.downloadFile();
                self.connected = false;
                self.reset();
            };

        },

        registerFileEvents: function () {
            this.fileManager.onrequestready = this.chunkRequestReady;
            this.fileManager.onprogress = this.updateProgress;
            this.fileManager.ontransfercomplete = this.transferComplete;
        },

        initProgress: function () {
            var self = this;
            var ctx = ctx = this.progress.getContext('2d');
            var imd = null;
            var circ = Math.PI * 2;
            var quart = Math.PI / 2;
            var interval;

            ctx.beginPath();
            ctx.strokeStyle = '#99CC33';
            ctx.lineCap = 'square';
            ctx.closePath();
            ctx.fill();
            ctx.lineWidth = 4.0;

            imd = ctx.getImageData(0, 0, 36, 36);

            this.updateProgress = function (percent) {
                ctx.putImageData(imd, 0, 0);
                ctx.beginPath();
                ctx.arc(18, 18, 7, -(quart), ((circ) * percent) - quart, false);
                ctx.stroke();
            };
        },

        reset: function () {
            if (this.available) {
                this.fileInput.removeAttribute("disabled");
                $(this.fileInput).removeClass("hidden");
            }
            this.statusBlink(false);
            this.updateProgress(0);
            this.fileManager.clear();
            this.fileInput.value = "";
            this.getButton.setAttribute("disabled", "disabled");
            this.cancelButton.setAttribute("disabled", "disabled");
            this.getButton.innerHTML = "Get File";
            this.isInitiator = false;
            this.connected = false;
        }

    }

    return Connection;
})();