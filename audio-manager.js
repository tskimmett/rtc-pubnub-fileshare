function AudioManager() {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.clips = [];
}

AudioManager.prototype = {
    addClip: function(arrayBuffer) {
        var source = this.audioCtx.createBufferSource();
        var self = this;
        this.audioCtx.decodeAudioData(arrayBuffer, function(buffer) {
            source.buffer = buffer;
            source.connect(self.audioCtx.destination);
            source.start(0);
            self.clips.push(source);
        });
    }
};