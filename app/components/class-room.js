import Janus from 'janus';
import Component from '@ember/component';
import {get, set} from '@ember/object';


export default class ClassRoom extends Component {
    // server = "http://janus.allright.io:8088/janus";
    opaqueId = 'videoroomtest' + Number(new Date());
    myRoom = 1234;

    janusSession = null;
    sfuPlugin = null;

    myId = null;
    myPrivateId = null;
    myStream = null;
    MAX_SIZE_SUBSCRIBERS = 6;


    feeds = [];
    bitrateTimer = [];

    myUsername = Janus.randomString(6);


    didInsertElement() {

        if (window.location.protocol === 'http:') {
            this.server = "http://" + 'janus.allright.io' + ":8088/janus";
        } else {
            this.server = "https://" + 'janus.allright.io' + ":8089/janus";
        }

        this.initializeJanus();
    }


    initializeJanus() {
        Janus.init({
            debug: true,
            callback: () => {
                this.janusInitCallback();
            }
        })
    }


    janusInitCallback() {

        // Make sure the browser supports WebRTC

        if (!Janus.isWebrtcSupported()) {
            alert('No WebRTC support...');
            return false;
        }


        this.janusSession = new Janus({
            server: this.server,
            success: (...args) => {
                this.connect(...args);
            },
            error(error) {
                Janus.error(error);
                alert(error);
                window.location.reload();
            },
            destroyed() {
                window.location.reload();
            }
        });

    }

    /**
     * Attach to video room
     */
    connect() {
        this.janusSession.attach({
            plugin: 'janus.plugin.videoroom',
            opaqueId: this.opaqueId,
            success: (pluginHandle) => {
                this.sfuPlugin = pluginHandle;
                Janus.log(`Plugin attached! ("${this.sfuPlugin.getPlugin()}", id="${this.sfuPlugin.getId()}")`);
                Janus.log("  -- This is a publisher/manager");

                // Send message -> Join to Room
                this.sfuPlugin.send({
                    message: {
                        request: "join",
                        room: this.myRoom,
                        ptype: "publisher",
                        display: this.myUsername
                    }
                });
            },
            onmessage: (msg, jsep) => {
                Janus.debug(" ::: Got a message (publisher) :::");
                Janus.debug(msg);

                let eventName = get(msg, 'videoroom');

                if (eventName) {
                    if (eventName === 'joined') {
                        // Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
                        this.myId = get(msg, 'id');
                        this.myPrivateId = get(msg, 'private_id');
                        let room = get(msg, 'room');

                        Janus.log(`Successfully joined room ${room} with ID ${this.myId}`);
                        this.publishOwnFeed(true);

                        // Any new feed to attach to?
                        let publishers = get(msg, 'publishers');
                        if (publishers) {

                            Janus.debug("Got a list of available publishers/feeds:");
                            Janus.debug(publishers);

                            for (let variable in publishers) {

                                if (!publishers.hasOwnProperty(variable)) {
                                    return false;
                                }
                                let publisher = publishers[variable];
                                let id = get(publisher, 'id');
                                let display = get(publisher, 'display');
                                let audio = get(publisher, 'audio_codec');
                                let video = get(publisher, 'video_codec');
                                Janus.debug(`  >> [${id}] ${display} (audio: ${audio}, video: ${video})`);

                                this.newRemoteFeed(id, display, audio, video);
                            }
                        }
                    } else if (eventName === 'destroyed') {
                        // The room has been destroyed
                        window.location.reload();
                    } else if (eventName === 'event') {
                        // Any new feed to attach to?
                        let publishers = get(msg, 'publishers');
                        let leaving = get(msg, 'leaving');
                        let unpublished = get(msg, 'unpublished');
                        let error = get(msg, 'error');

                        if (publishers) {

                            Janus.debug("Got a list of available publishers/feeds:");
                            Janus.debug(publishers);

                            for (let variable in publishers) {

                                if (!publishers.hasOwnProperty(variable)) {
                                    return false;
                                }
                                let publisher = publishers[variable];
                                let id = get(publisher, 'id');
                                let display = get(publisher, 'display');
                                let audio = get(publisher, 'audio_codec');
                                let video = get(publisher, 'video_codec');
                                Janus.debug(`  >> [${id}] ${display} (audio: ${audio}, video: ${video})`);

                                this.newRemoteFeed(id, display, audio, video);
                            }
                        } else if (leaving) {
                            Janus.log("Publisher left: " + leaving);
                            let remoteFeed = null;

                            for (let i = 1; i < this.MAX_SIZE_SUBSCRIBERS; i++) {
                                if (this.feeds[i] && this.feeds[i] === leaving) {
                                    remoteFeed = this.feeds[i];
                                    break;
                                }
                            }

                            if (remoteFeed) {
                                Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                                this.feeds[remoteFeed.rfindex] = null;
                                remoteFeed.detach();
                            }
                        } else if (unpublished) {
                            // One of the publishers has unpublished?
                            Janus.log("Publisher left: " + unpublished);

                            if (unpublished === 'ok') {
                                // That's us
                                this.sfuPlugin.hangup();
                                return false;
                            }

                            let remoteFeed = null;

                            for (let i = 1; i < this.MAX_SIZE_SUBSCRIBERS; i++) {
                                if (this.feeds[i] && this.feeds[i] === unpublished) {
                                    remoteFeed = this.feeds[i];
                                    break;
                                }
                            }

                            if (remoteFeed) {
                                Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                                this.feeds[remoteFeed.rfindex] = null;
                                remoteFeed.detach();
                            }
                        }

                        if (error) {
                            if (get(msg, 'error_code') === 426) {
                                alert(
                                    "<p>Apparently room <code>" + this.myRoom + "</code> (the one this demo uses as a test room) " +
                                    "does not exist...</p><p>Do you have an updated <code>janus.plugin.videoroom.cfg</code> " +
                                    "configuration file? If not, make sure you copy the details of room <code>" + this.myRoom + "</code> " +
                                    "from that sample in your current configuration file, then restart Janus and try again."
                                );
                            } else {
                                alert(error)
                            }
                        }
                    }


                }

                if (jsep) {
                    Janus.debug("Handling SDP as well...");
                    Janus.debug(jsep);

                    this.sfuPlugin.handleRemoteJsep({
                        jsep: jsep
                    });

                    let audio = get(msg, 'audio_codec');
                    let video = get(msg, 'video_codec');

                    if (
                        this.myStream &&
                        this.myStream.getAudioTracks() &&
                        this.myStream.getAudioTracks().length > 0 &&
                        !audio
                    ) {
                        // Audio has been rejected
                        console.warning("Our audio stream has been rejected, viewers won't hear us");
                    }

                    if (
                        this.myStream &&
                        this.myStream.getVideoTracks() &&
                        this.myStream.getVideoTracks().length > 0 &&
                        !video
                    ) {
                        // Video has been rejected
                        console.warning("Our video stream has been rejected, viewers won't see us");
                    }
                }
            },

            onlocalstream: (stream) => {
                Janus.debug(" ::: Got a local stream :::");

                this.myStream = stream;

                Janus.debug(stream);

                let VideoContainer = document.querySelector('#container');

                let videoElement = VideoContainer.querySelector('video#publisher');

                if (!videoElement) {
                    videoElement = document.createElement('video');
                    videoElement.id = 'publisher';

                    VideoContainer.append(this.wrapItemVideo(videoElement, 'pub'));
                }

                videoElement.setAttribute('autoplay', '');
                videoElement.setAttribute('playsinline', '');
                videoElement.setAttribute('muted', 'muted');

                Janus.attachMediaStream(videoElement, stream);
                videoElement.muted = 'muted';
            },

            error(error) {
                Janus.log("  -- Error attaching plugin...", error);
            },
            consentDialog(on) {
                Janus.log("Consent dialog should be " + (on ? "on" : "off") + " now");
            },
            webrtcState: (on) => {
                Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
                if (!on) {
                    return false;
                }

                this.sfuPlugin.send({"message": { "request": "configure", "bitrate": 0 }});
            },
            oncleanup: () => {
                Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
                this.myStream = null;
                // this.publishOwnFeed(true);
            }
        })
    }


    publishOwnFeed(useAudio) {
        this.sfuPlugin.createOffer({
            // Add data:true here if you want to publish datachannels as well
            media: {
                audioRecv: false,
                videoRecv: false,
                audioSend: useAudio,
                videoSend: true,
                video: 'lowres'
            },	// Publishers are sendonly

            // If you want to test simulcasting (Chrome and Firefox only), then
            // pass a ?simulcast=true when opening this demo page: it will turn
            // the following 'simulcast' property to pass to janus.js to true
            simulcast: true,
            success: (jsep) => {
                Janus.debug("Got publisher SDP!");
                Janus.debug(jsep);

                let publish = {
                    "request": "configure",
                    "audio": useAudio,
                    "video": true,
                    "videocodec": "h264"
                };
                // You can force a specific codec to use when publishing by using the
                // audiocodec and videocodec properties, for instance:
                // 		publish["audiocodec"] = "opus"
                // to force Opus as the audio codec to use, or:
                // 		publish["videocodec"] = "vp9"
                // to force VP9 as the videocodec to use. In both case, though, forcing
                // a codec will only work if: (1) the codec is actually in the SDP (and
                // so the browser supports it), and (2) the codec is in the list of
                // allowed codecs in a room. With respect to the point (2) above,
                // refer to the text in janus.plugin.videoroom.cfg for more details

                this.sfuPlugin.send({
                    message: publish,
                    jsep: jsep
                })
            },
            error: (error) => {
                Janus.error("WebRTC error:", error);

                if (useAudio) {
                    this.publishOwnFeed(false);
                } else {
                    alert("WebRTC error... " + JSON.stringify(error));
                    this.publishOwnFeed(true);
                }
            }
        })
    }


    newRemoteFeed(id, display, audio, video) {
        let remoteFeed = null;

        let subscriber = this.janusSession.attach({
            plugin: "janus.plugin.videoroom",
            opaqueId: this.opaqueId,
            success: (pluginHandle) => {
                remoteFeed = pluginHandle;
                remoteFeed.simulcastStarted = false;
                Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
                Janus.log("  -- This is a subscriber");
                let subscribe = {
                    request: "join",
                    room: this.myRoom,
                    ptype: "subscriber",
                    feed: id,
                    private_id: this.myPrivateId
                };

                if (Janus.webRTCAdapter.browserDetails.browser === "safari" &&
                    (video === "vp9" || (video === "vp8" && !Janus.safariVp8))) {
                    if (video) {
                        video = video.toUpperCase();
                    }

                    console.warning("Publisher is using " + video + ", but Safari doesn't support it: disabling video");

                    set(subscribe, 'offer_video', false);
                }
                remoteFeed.videoCodec = video;
                remoteFeed.send({
                    message: subscribe
                });
            },
            onmessage: (msg, jsep) => {
                Janus.debug(" ::: Got a message (subscriber) :::");
                Janus.debug(msg);

                let eventName = get(msg, 'videoroom');
                Janus.debug("Event: " + eventName);

                let error = get(msg, 'error');

                if (error) {
                    alert(error);
                } else if (eventName) {
                    if (eventName === 'attached') {

                        for (let i = 1; i < this.MAX_SIZE_SUBSCRIBERS; i++) {
                            if (!this.feeds[i]) {
                                this.feeds[i] = remoteFeed;
                                remoteFeed.rfindex = i;
                                break;
                            }
                        }

                        remoteFeed.rfid = get(msg, 'id');
                        remoteFeed.rfdisplay = get(msg, 'display');


                        Janus.log(`Successfully attached to feed ${remoteFeed.rfid} (${remoteFeed.rfdisplay}) in room ${get(msg, 'room')}]`);
                    } else if (eventName === 'event') {
                        // Check if we got an event on a simulcast-related event from this publisher
                        let substream = get(msg, 'substream');
                        let temporal = get(msg, 'temporal');
                    }
                }

                if (jsep) {
                    Janus.debug("Handling SDP as well...");
                    Janus.debug(jsep);

                    remoteFeed.createAnswer(
                        {
                            jsep: jsep,
                            // Add data:true here if you want to subscribe to datachannels as well
                            // (obviously only works if the publisher offered them in the first place)
                            media: {
                                audioSend: false,
                                videoSend: false
                            },	// We want recvonly audio/video
                            success: (jsep) => {
                                Janus.debug("Got SDP!");
                                Janus.debug(jsep);

                                remoteFeed.send({
                                    message: {
                                        request: "start",
                                        room: this.myRoom
                                    },
                                    jsep: jsep
                                });
                            },
                            error: (error) => {
                                Janus.error("WebRTC error:", error);
                                alert("WebRTC error... " + JSON.stringify(error));
                            }
                        });
                }

            },
            error: (error) => {
                Janus.error("  -- Error attaching plugin...", error);
                alert("Error attaching plugin... " + error);
            },
            webrtcState: function (on) {
                Janus.log("Janus says this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
            },
            onlocalstream: (onlocalstream) => {
                // The subscriber stream is recvonly, we don't expect anything here
            },
            onremotestream: (stream) => {
                Janus.debug("Remote feed #" + remoteFeed.rfindex);
                let VideoContainer = document.querySelector('#container');
                let remoteVideo = VideoContainer.querySelector(`video#remotedvideo-${remoteFeed.rfindex}`);

                if (!remoteVideo) {
                    remoteVideo = document.createElement('video');
                    remoteVideo.id = `remotedvideo-${remoteFeed.rfindex}`;

                    remoteVideo.setAttribute('autoplay', '');
                    remoteVideo.setAttribute('playsinline', '');

                    remoteVideo.addEventListener('playing', () => {
                        // let width = subscriber.videoWidth;
                        // let height = subscriber.videoHeight;

                        if (Janus.webRTCAdapter.browserDetails.browser === "firefox") {
                            // Firefox Stable has a bug: width and height are not immediately available after a playing
                            // setTimeout(function() {
                            //     // var width = $("#remotevideo"+remoteFeed.rfindex).get(0).videoWidth;
                            //     // var height = $("#remotevideo"+remoteFeed.rfindex).get(0).videoHeight;
                            // }, 2000);
                        }
                    });

                    VideoContainer.append(this.wrapItemVideo(remoteVideo, 'sub'));
                }

                Janus.attachMediaStream(remoteVideo, stream);

                if (Janus.webRTCAdapter.browserDetails.browser === "chrome" || Janus.webRTCAdapter.browserDetails.browser === "firefox" ||
                    Janus.webRTCAdapter.browserDetails.browser === "safari") {
                    // this.bitrateTimer[remoteFeed.rfindex] = setInterval(function() {
                    //     // Display updated bitrate, if supported
                    //     let bitrate = remoteFeed.getBitrate();
                    //
                    //     console.log('bitrate: ', bitrate);
                    // }, 1000);
                }

            },
            oncleanup: () => {
                Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
                setTimeout(() =>{
                    this.removeVideoItem(document.querySelector('#remotedvideo-' + remoteFeed.rfindex));
                }, 0);

            }
        })

    }

    wrapItemVideo(videoElement, type){
        let wrapper = document.createElement('div');
        wrapper.classList.add('col-md-4');
        wrapper.classList.add('wrap-video');
        wrapper.classList.add(type);

        wrapper.append(videoElement);

        if (type === 'pub'){
            let btn = document.createElement('button');
            btn.className = 'btn btn-warning btn-xs';
            btn.textContent = 'Mute';
            btn.onclick = this.toogleMute.bind(this);
            wrapper.append(btn);
        }

        return wrapper;
    }

    removeVideoItem(videoElement){
        let parent = videoElement.parentNode;

        if (parent.classList.contains('wrap-video')){
            parent.remove();
        } else {
            videoElement.remove();
        }
    }

    toogleMute(e){
        e.preventDefault();

        let muted = this.sfuPlugin.isAudioMuted();
        Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");

        if (muted){
            this.sfuPlugin.unmuteAudio();
        } else {
            this.sfuPlugin.muteAudio();
        }

        e.currentTarget.textContent = muted ? "Unmute" : "Mute";
    }
}


