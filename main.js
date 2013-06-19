(function () {
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
  var USING_GOOGLE = false;

  if (IS_CHROME) {
    RTCPeerConnection = webkitRTCPeerConnection;
    //RTCIceCandidate = webkitRTCIceCandidate;
    //RTCSessionDescription = webkitRTCSessionDescription;
  }
  else {
    RTCPeerConnection = mozRTCPeerConnection;
    RTCIceCandidate = mozRTCIceCandidate;
    RTCSessionDescription = mozRTCSessionDescription;
  }

  function createFSClient() {
    var CONTACT_API_URL = "https://www.google.com/m8/feeds";
    var pubnub;
    function FSClient() {
      this.connections = {};
    };

    FSClient.prototype = {
      localLogin: function (name) {
        this.uuid = name;
        pubnub = PUBNUB.init({
          publish_key: 'pub-c-b2d901ee-2a0f-4d89-8cd3-63039aa6dd90',
          subscribe_key: 'sub-c-c74c7cd8-cc8b-11e2-a2ac-02ee2ddab7fe',
          uuid: this.uuid
        });

        $(".my-email").html(this.uuid);

        pubnub.subscribe({
          channel: protocol.CHANNEL,
          callback: this.handleSignal.bind(this),
          presence: this.handlePresence.bind(this)
        });
      },

      obtainGoogleToken: function () {
        var params = {
          response_type: "token",
          client_id: "999382287610.apps.googleusercontent.com",
          redirect_uri: window.location.origin + window.location.pathname,
          scope: CONTACT_API_URL
        };
        var query = [];
        for (var p in params) {
          query.push(p + "=" + encodeURIComponent(params[p]));
        }
        query = query.join("&");
        window.open("https://accounts.google.com/o/oauth2/auth?" + query, "_self");
      },

      getContacts: function () {
        var self = this;
        $.ajax({
          url: CONTACT_API_URL + "/contacts/default/full",
          data: {
            access_token: this.token,
            v: 3.0,
            alt: "json",
            "max-results": 100
          }
        }).done(function (res) {
          self.uuid = res.feed.author[0].email["$t"];
          $(".my-email").html(self.uuid);
          pubnub = PUBNUB.init({
            publish_key: 'pub-c-b2d901ee-2a0f-4d89-8cd3-63039aa6dd90',
            subscribe_key: 'sub-c-c74c7cd8-cc8b-11e2-a2ac-02ee2ddab7fe',
            uuid: self.uuid
          });

          pubnub.subscribe({
            channel: protocol.CHANNEL,
            callback: self.handleSignal.bind(self),
            presence: self.handlePresence.bind(self)
          });

          var contacts = res.feed.entry;
          var email, c;
          var list = $(".contact-list");
          var template = _.template($("#contact-template").html().trim());
          contacts.forEach(function (e) {
            if (!e["gd$email"]) {
              return;
            }
            email = e["gd$email"][0].address;
            if (self.uuid === email) {
              //return;
            }
            c = template({ email: email, available: false });
            list.append($(c));
            self.connections[email] = new Connection(email,
	            document.getElementById("contact-" + email),
	            self.uuid, pubnub);
          });

          $(".contact-list").animate({ marginTop: "20px" }, 700);
        });
      },

      /**
				"Signals" are sent via PubNub until the DataChannel is established
			**/
      handleSignal: function (msg) {
        var self = this;
        console.log("Main: ", msg);
        // Don't care about messages we send
        if (msg.uuid !== this.uuid && msg.target === this.uuid) {
          var targetConnection = self.connections[msg.uuid];
          if (msg.desc) {
            targetConnection.receiveDesc(msg);
          }
          else if (msg.candidate) {
            targetConnection.receiveICE(msg.candidate);
          }
          else {
            targetConnection.handleSignal(msg);
          }
        }
      },

      handlePresence: function (msg) {
        console.log("Main: ", msg);
        // Only care about presence messages from people in our Google contacts (if HOSTED)
        var conn = this.connections[msg.uuid];
        if (conn) {
          conn.handlePresence(msg);
        }
        else if (!USING_GOOGLE && msg.uuid !== this.uuid && msg.action === "join") {
          var template = _.template($("#contact-template").html().trim());
          var email = msg.uuid;
          console.log(msg.action == "join");
          $(".contact-list").append(
						$(template({ email: email, available: true }))
					);
          this.connections[email] = new Connection(email,
	          document.getElementById("contact-" + email),
	          this.uuid, pubnub);
          this.connections[email].handlePresence(msg);
          $(".contact-list").animate({ marginTop: "20px" }, 700);
        }
      }
    };
    return new FSClient();
  };


  var client = createFSClient();

  $(".login-area").fadeIn();
  var confirm = $(".confirm-name");
  var confirmArea = $(".confirm-name-area");
  var input = $(".name-input");
  var googleLogin = $("#google-login-button");

  confirm.hover(function () {
    confirm.stop();
    confirm.animate({ color: "#669999" }, 300);
  }, function () {
    confirm.stop();
    confirm.animate({ color: "white" }, 300);
  });

  confirm.click(function () {
    $(".login-area").fadeOut();
    client.localLogin(input.val());
  });

  input.on("input", function () {
    var curr = $(this).val();
    curr = curr.replace(/\W/g, "");
    $(this).val(curr);
    if (curr.length > 2 && curr.length < 20) {
      if (curr.length >= 3 || curr.length <= 19) {
        if (confirmArea.height() != 38) {
          confirm.fadeIn();
          confirmArea.animate({ height: "38px" }, 300);
        }
      }
    }
    else {
      //confirm.stop();
      //confirmArea.stop();
      if (confirmArea.height() != 0) {
        confirm.fadeOut();
        confirmArea.animate({ height: "0px" }, 300);
      }
    }
  });

  googleLogin.click(function (event) {
    client.obtainGoogleToken();
    USING_GOOGLE = true;
  });

  // First, parse the query string
  var params = {}, queryString = location.hash.substring(1),
    regex = /([^&=]+)=([^&]*)/g, m;
  while (m = regex.exec(queryString)) {
    params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
  }

  if (params.access_token) {
    window.location.hash = "";
    this.token = params.access_token;
    //$.ajax({
    //	url: "https://www.googleapis.com/oauth2/v1/tokeninfo",
    //	data: {
    //		access_token: this.token
    //	}
    //}).done(function (res) {
    //	console.log(res);
    //});
    this.getContacts();
    return;
  }
})();
