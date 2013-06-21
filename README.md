rtc-pubnub-fileshare
====================
This is a demo which allows users to share files with each other using Peer-to-peer connections via WebRTC DataChannel. All signaling and connection negotiation is accomplished using PubNub via their [beta WebRTC API](https://github.com/pubnub/webrtc).

Features
---------------
"Common-room" version where users choose a name and can see and share files with everyone using the demo.

Google login version where users login with Google and can share files with anyone in their Google contacts who is using the demo.

Use
---------------
The demo can be run from your local filesystem or from an actual web server. But the easiest way to see the demo in action is via the [GitHub page](http://tskimmett.github.io/rtc-pubnub-fileshare).

**Note:** the Google login functionality will be unavailable if running the demo from your local filesystem or your own webserver, *unless* you edit the code to change the Google OAUTH2 parameters to use your own API key.

Browser Support
---------------
Currently only browsers which support WebRTC (Chrome stable and Firefox Beta as of 6-14-2013)