function FileManager(chunkSize) {
    this.fileName = null;
    this.buffer = null;
    this.chunkSize = chunkSize;
    this.fileChunks = [];
    this.missingChunks = [];
    this.numRequested = 0;
    this.requestMax = 90;
    this.requestThreshold = 70;
    this.expireTime = 2000;
    this.nChunksReceived = 0;
    this.nChunksExpected = 0;

    this.onrequestready = null;
};

FileManager.prototype = {
    stageLocalFile: function (fName, fType, buffer) {
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

    stageRemoteFile: function (fName, fType, nChunks) {
        this.fileName = fName;
        this.fileType = fType;
        this.fileChunks = [];
        this.missingChunks = [];
        this.numRequested = 0;
        this.nChunksReceived = 0;
        this.nChunksExpected = nChunks;
        // All chunks are missing to start
        for (var i = 0; i < nChunks; i++) {
            this.missingChunks[i] = true;
        }
    },

    receiveChunk: function (data) {
        if (!this.fileChunks[data.id]) {
            this.fileChunks[data.id] = Base64Binary.decode(data.content);
            this.nChunksReceived++;
            this.numRequested--;
            if (typeof (this.onprogress) == "function") {
                this.onprogress(this.nChunksReceived / this.nChunksExpected);
            }
            if (!this.transferComplete()) {
                if (this.numRequested < this.requestThreshold) {
                    this.requestChunks();
                }
            }
            else {
                this.ontransfercomplete();
            }
        }
    },

    requestChunks: function () {
        var self = this;
        var chunks = [];
        var n = 0;
        for (var id in this.missingChunks) {
            chunks.push(id);
            delete this.missingChunks[id];
            if (++n >= this.requestMax) {
                break;
            }
        }
        this.numRequested += n;
        if (!n) {
            return;
        }

        /***
         * This will act as a synchronous return when requestChunks
         * is called directly from Connection, but asynchronously
         * when called from the timeout.
         ***/
        this.onrequestready(chunks);

        this.chunkTimeout = setTimeout(function () {
            var expired = 0;
            for (var i in chunks) {
                var id = chunks[i];
                if (!self.fileChunks[id]) {
                    expired++;
                    self.numRequested--;
                    self.missingChunks[id] = true;
                }
            }
            if (expired && self.numRequested < self.requestThreshold) {
                self.requestChunks();
            }
        }, this.expireTime);
    },

    transferComplete: function () {
        return (this.nChunksExpected == this.nChunksReceived);
    },

    downloadFile: function () {
        var blob = new Blob(this.fileChunks, { type: this.fileType });
        var link = document.querySelector("#download");
        link.href = window.URL.createObjectURL(blob);
        link.download = this.fileName;
        link.click();
    },

    clear: function () {
        this.fileName = null;
        this.buffer = null;
        clearTimeout(this.chunkTimeout);
    }
};