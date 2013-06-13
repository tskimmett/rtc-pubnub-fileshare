rtc-pubnub-fileshare
====================
This is a demo which allows users to share files with each other using Peer-to-peer connections via WebRTC DataChannel. All signaling and connection negotiation is accomplished using PubNub.

How to use
----------
The demo can be run from your local filesystem or from an actual web server.

If you run it on a web server, the app will pull your Google contacts in using OAUTH 2. Then if anyone in your Google contacts starts using the demo, you'll be able to share files with them.

If you run it on your local filesystem, then everyone using the demo will simply be in the same "room" and can share files with each other.