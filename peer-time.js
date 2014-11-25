function PeerTime(pubnub, mode) {
    this.mode = typeof mode !== 'undefined' ? mode : 'exponential';
    if (this.mode == 'array') {
        this.drifts = [];
    } else if (this.mode == 'exponential') {
        this.drift = 0;
    } else {
        throw new Error('Invalid mode', this.mode);
    }
    this.pubnub = pubnub;
    this.numSyncs = 0;
    this.syncDrift();
    var self = this;
    window.setInterval(function () {
        self.syncDrift();
    }, 1000);
}

PeerTime.prototype = {
    syncDrift: function () {
        var self = this;
        var tripStartTime = new Date();
        this.pubnub.time(
            function (timeIn10thOfNs) {
                var currTime = new Date();
                var TENTHS_OF_NANOSECOND_PER_MILLISECOND = 10000;
                var timeMs = timeIn10thOfNs / TENTHS_OF_NANOSECOND_PER_MILLISECOND;
                var estimatedTimeFromServer = (currTime - tripStartTime) / 2;
                var currDrift = timeMs - estimatedTimeFromServer - currTime;
                if (this.mode == 'array') {
                    this.drifts.push(currDrift);
                } else if (this.mode == 'exponential') {
                    var percPrevToUse = Math.max(1.0 - self.numSyncs / (self.numSyncs + 1), 0.1);
                    this.drift = percPrevToUse * this.drift + (1 - percPrevToUse) * currDrift;
                } else {
                    throw new Error('Invalid mode', this.mode);
                }
                self.numSyncs++;
            }
        );
    },

    avgDrift: function () {
        if (this.mode !== 'array') {
            console.error('Called avgDrift using mode', this.mode);
        }
        var drift = 0;
        var len = this.drifts.length;
        for (var i = 0; i < len; i++) {
            drift += this.drifts[i];
        }
        drift /= len;
        return drift;
    },

    currTime: function () {
        var curr = new Date();
        var drift;
        if (this.mode == 'array') {
            drift = this.avgDrift();
        } else if (this.mode == 'exponential') {
            drift = this.drift;
        } else {
            throw new Error('Invalid mode', this.mode);
        }
        curr.setMilliseconds(curr.getMilliseconds() + drift);
        console.log('Currtime with drift', drift, 'is', curr);
        return curr;
    }
};
