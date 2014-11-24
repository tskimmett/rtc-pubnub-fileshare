function PeerTime() {
    this.drift = 0;
    this.syncDrift();
}

PeerTime.prototype = {
    syncDrift: function() {
         // TODO use pubnub.time to sync ??
    },
    currTime: function () {
        return new Date(); // TODO factor in drift
    }
}
