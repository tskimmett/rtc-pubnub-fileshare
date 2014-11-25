function PeerTime(pubnub) {
    this.drifts = [];
    this.pubnub = pubnub;
    var self = this;
    window.setInterval(function() {
        self.syncDrift();
    }, 1000);
}

PeerTime.prototype = {
    syncDrift: function () {
        var self = this;
        var tripStartTime = new Date();
        this.pubnub.time(
            function (time) {
                var tripEndTime = new Date();
                var currDrift = time / 10000 - (tripEndTime - tripStartTime) / 2 - new Date();
                self.drifts.push(currDrift); //TODO use O(1) memory moving average.
            }
        );
    },
    currTime: function () {
        curr = new Date();
        drift = 0;
        var len = this.drifts.length;
        for (var i = 0; i < len; i++) {
            drift += this.drifts[i];
        }
        drift /= len;
        console.log('TODO Drifts are', this.drifts);
        curr.setMilliseconds(curr.getMilliseconds() + drift);
        console.log('Currtime with drift', drift, 'is', curr);
        return curr;
    }
};
