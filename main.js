(function () {
    var HOST = "markulrich.github.io"
    if (window.location.host == HOST && window.location.protocol != "https:") {
        window.location.protocol = "https:"
    }


    var HOSTED = window.location.protocol !== "file:";
    // Easier than comparing string literals
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
    var USING_GOOGLE = false;

    function createFSClient() {
        var CONTACT_API_URL = "https://www.google.com/m8/feeds";
        var pubnub, peerTime;
        function FSClient() {
            this.connections = {};
            this.contactEmails = {};
        };

        FSClient.prototype = {
            localLogin: function (name) {
                this.uuid = name;
                pubnub = PUBNUB.init({
                    publish_key: PUB_KEY,
                    subscribe_key: SUB_KEY,
                    uuid: this.uuid,
                    ssl: true
                });
                peerTime = new PeerTime(pubnub);

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
                    client_id: "84873858196-sp4u8nbinq360u6pti0sqk745vu7547p.apps.googleusercontent.com",
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

            getContacts: function (token) {
                this.token = token;
                var self = this;
                var req = {
                    url: CONTACT_API_URL + "/contacts/default/full",
                    data: {
                        access_token: this.token,
                        v: 3.0,
                        alt: "json",
                        "max-results": 10000
                    }
                };
                var handleRes = function (res) {
                    self.uuid = res.feed.author[0].email["$t"].toLowerCase();
                    $(".my-email").html(self.uuid);
                    pubnub = PUBNUB.init({
                        publish_key: PUB_KEY,
                        subscribe_key: SUB_KEY,
                        uuid: self.uuid,
                        ssl: true
                    });
                    peerTime = new PeerTime(pubnub);

                    pubnub.subscribe({
                        channel: protocol.CHANNEL,
                        callback: self.handleSignal.bind(self),
                        presence: self.handlePresence.bind(self)
                    });

                    var contacts = res.feed.entry;
                    var email, c, numShown = 0;
                    var list = $(".contact-list");
                    var template = _.template($("#contact-template").html().trim());
                    console.log(res);
                    contacts.forEach(function (e) {
                        if (!e["gd$email"]) {
                            return;
                        }
                        email = e["gd$email"][0].address.toLowerCase();
                        // Don't consider ourselves a contact
                        if (self.uuid === email) {
                            return;
                        }
                        self.contactEmails[email] = true;
                        if (numShown < 25) {
                            c = template({ email: email, available: false });
                            list.append($(c));
                            self.connections[email] = new Connection(email,
                              document.getElementById("contact-" + email),
                              self.uuid, pubnub, peerTime);
                            numShown++;
                        }
                    });
                    $(".contact-list").animate({ marginTop: "35px" }, 700);
                    if (res.next) {
                        req.url = res.next;
                        $.ajax(req).done(handleRes);
                    }
                }
                $.ajax(req).done(handleRes);
            },

            handleSignal: function (msg) {
                var self = this;
                // Don't care about messages we send
                if (msg.uuid !== this.uuid && msg.target === this.uuid) {
                    var targetConnection = self.connections[msg.uuid];
                    targetConnection.handleSignal(msg);
                }
            },

            handlePresence: function (msg) {
                // Only care about presence messages from people in our Google contacts (if HOSTED)
                var conn = this.connections[msg.uuid];
                if (conn) {
                    conn.handlePresence(msg);
                }
                else if (this.contactEmails[msg.uuid] && msg.action === "join") {
                    var email = msg.uuid;
                    var list = $(".contact-list");
                    var template = _.template($("#contact-template").html().trim());
                    list.prepend($(template({ email: email, available: true })));
                    this.connections[email] = new Connection(email,
                      document.getElementById("contact-" + email),
                      this.uuid, pubnub, peerTime);
                    this.connections[email].handlePresence(msg);
                }
                else if (!USING_GOOGLE && msg.uuid !== this.uuid && msg.uuid.indexOf("@") == -1 && msg.action === "join") {
                    var template = _.template($("#contact-template").html().trim());
                    var email = msg.uuid;
                    console.log(msg.action == "join");
                    $(".contact-list").append(
                                  $(template({ email: email, available: true }))
                              );
                    this.connections[email] = new Connection(email,
                        document.getElementById("contact-" + email),
                        this.uuid, pubnub, peerTime);
                    this.connections[email].handlePresence(msg);
                    $(".contact-list").animate({ marginTop: "35px" }, 700);
                }
            }
        };
        return new FSClient();
    }

    var PUB_KEY = "pub-c-24cc8449-f45e-4bdf-97b5-c97bbb6479d0";
    var SUB_KEY = "sub-c-60fc9a74-6f61-11e4-b563-02ee2ddab7fe";

    function randomInt(min, max) {
      return Math.floor(Math.random() * (max - min)) + min;
    }

    function capitalize(s) {
        return _.map(s.split(" "), function(w) {
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(" ");
    }

    var client = createFSClient();
    var animals = $.get("/animals.json");
    var adjectives = $.get("/adjectives.json");
    $.when(animals, adjectives).done(function(animals, adjectives) {
        animals = animals[0];
        adjectives = adjectives[0];
        var animal = animals[randomInt(0, animals.length)];
        var adjective = adjectives[randomInt(0, adjectives.length)];
        client.localLogin(capitalize(adjective + " " + animal));
    });

    // First, parse the query string
    var params = {}, queryString = location.hash.substring(1),
      regex = /([^&=]+)=([^&]*)/g, m;
    while (m = regex.exec(queryString)) {
        params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
    }

    if (params.access_token) {
        window.location.hash = "";
        USING_GOOGLE = true;
        client.getContacts(params.access_token);
        return;
    }
    else {
        $(".login-area").fadeIn();
    }
})();
