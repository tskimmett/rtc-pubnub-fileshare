function PeerTime(pubnub) {
    this.drift = 0;
    this.pubnub = pubnub;
    this.syncDrift();
    //window.setInterval(Timeout(this.syncDrift, ;
}

PeerTime.prototype = {
    syncDrift: function () {
        var self = this;
        this.pubnub.time(
            function (time) {
                self.drift = time - new Date();
            }
        );
    },
    currTime: function () {
        curr = new Date();
        curr.setMilliseconds(curr.getMilliseconds() + this.drift);
        return curr;
    }
};
