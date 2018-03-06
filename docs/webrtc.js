const localVideo = document.getElementById('local_video');
const remoteVideo = document.getElementById('remote_video');
const textForSendSdp = document.getElementById('text_for_send_sdp');
const textToReceiveSdp = document.getElementById('text_for_receive_sdp');
let localStream = null;
let peerConnection = null;
let negotiationneededCounter = 0;
let isOffer = false;

text_for_send_sdp.value = text_for_receive_sdp.value = '';

// シグナリングサーバへ接続する
const wsUrl = 'ws://localhost:3001/';
const ws = new WebSocket(wsUrl);
ws.onopen = (evt) => {
    console.log('ws open()');
};
ws.onerror = (err) => {
    console.error('ws onerror() ERR:', err);
};
ws.onmessage = (evt) => {
    console.log('ws onmessage() data:', evt.data);
    const message = JSON.parse(evt.data);
    switch (message.type) {
        case 'offer': {
            addLog('log', 'Received offer ...');
            textToReceiveSdp.value = message.sdp;
            setOffer(message);
            break;
        }
        case 'answer': {
            addLog('log', 'Received answer ...');
            textToReceiveSdp.value = message.sdp;
            setAnswer(message);
            break;
        }
        case 'candidate': {
            addLog('log', 'Received ICE candidate ...');
            const candidate = new RTCIceCandidate(message.ice);
            addLog('log', message.ice);
            addIceCandidate(message.ice);
            break;
        }
        case 'close': {
            addLog('log', 'peer is closed ...');
            hangUp();
            break;
        }
        default: {
            addLog('log', 'Invalid message');
            break;
        }
    }
};

// ICE candaidate受信時にセットする
function addIceCandidate(candidate) {
    if (peerConnection) {
        peerConnection.addIceCandidate(candidate);
    }
    else {
        addLog('error', 'PeerConnection not exist!');
        return;
    }
}

// ICE candidate生成時に送信する
function sendIceCandidate(candidate) {
    //addLog('log', '---sending ICE candidate ---');
    const message = JSON.stringify({ type: 'candidate', ice: candidate });
    addLog('log', 'sending candidate=' + message);
    ws.send(message);
}

// getUserMediaでカメラ、マイクにアクセス
async function startVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        playVideo(localVideo, localStream);
    } catch (err) {
        addLog('error', 'mediaDevice.getUserMedia() error: ' + err.message);
    }
}

// Videoの再生を開始する
async function playVideo(element, stream) {
    element.srcObject = stream;
    await element.play();
}

// WebRTCを利用する準備をする
function prepareNewConnection(isOffer) {
    const pc_config = { "iceServers": [{ "urls": "stun:stun.webrtc.ecl.ntt.com:3478" }] };
    const peer = new RTCPeerConnection(pc_config);

    // リモートのMediStreamTrackを受信した時
    peer.ontrack = evt => {
        addLog('log', '-- peer.ontrack()');
        playVideo(remoteVideo, evt.streams[0]);
    };

    // ICE Candidateを収集したときのイベント
    peer.onicecandidate = evt => {
        if (evt.candidate) {
            addLog('log', evt.candidate);
            sendIceCandidate(evt.candidate);
        } else {
            addLog('log', 'empty ice event');
            // sendSdp(peer.localDescription);
        }
    };

    // Offer側でネゴシエーションが必要になったときの処理
    peer.onnegotiationneeded = async () => {
        try {
            if (isOffer) {
                if (negotiationneededCounter === 0) {
                    let offer = await peer.createOffer();
                    addLog('log', 'createOffer() succsess in promise');
                    await peer.setLocalDescription(offer);
                    addLog('log', 'setLocalDescription() succsess in promise');
                    sendSdp(peer.localDescription);
                    negotiationneededCounter++;
                }
            }
        } catch (err) {
            addLog('error', 'setLocalDescription(offer) ERROR: ' + err.message);
        }
    }

    // ICEのステータスが変更になったときの処理
    peer.oniceconnectionstatechange = () => {
        addLog('log', 'ICE connection Status has changed to ' + peer.iceConnectionState);
        switch (peer.iceConnectionState) {
            case 'closed':
            case 'failed':
                if (peerConnection) {
                    hangUp();
                }
                break;
            case 'dissconnected':
                break;
        }
    };

    // ローカルのMediaStreamを利用できるようにする
    if (localStream) {
        addLog('log', 'Adding local stream...');
        localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    } else {
        addLog('warn', 'no local stream, but continue.');
    }

    return peer;
}

// 手動シグナリングのための処理を追加する
function sendSdp(sessionDescription) {
    //addLog('log', '---sending sdp ---');
    textForSendSdp.value = sessionDescription.sdp;
    /*---
     textForSendSdp.focus();
     textForSendSdp.select();
     ----*/
    const message = JSON.stringify(sessionDescription);
    addLog('log', 'sending SDP=' + message);
    ws.send(message);
}

// Connectボタンが押されたらWebRTCのOffer処理を開始
function connect() {
    if (!peerConnection) {
        addLog('log', 'make Offer');
        peerConnection = prepareNewConnection(true);
    }
    else {
        console.warn('peer already exist.');
    }
}

// Answer SDPを生成する
async function makeAnswer() {
    addLog('log', 'sending Answer. Creating remote session description...');
    if (!peerConnection) {
        addLog('error', 'peerConnection NOT exist!');
        return;
    }
    try {
        let answer = await peerConnection.createAnswer();
        addLog('log', 'createAnswer() succsess in promise');
        await peerConnection.setLocalDescription(answer);
        addLog('log', 'setLocalDescription() succsess in promise');
        sendSdp(peerConnection.localDescription);
    } catch (err) {
        addLog('error', err.message);
    }
}

// Receive remote SDPボタンが押されたらOffer側とAnswer側で処理を分岐
function onSdpText() {
    const text = textToReceiveSdp.value;
    if (peerConnection) {
        addLog('log', 'Received answer text...');
        setAnswer({
            type: 'answer',
            sdp: text,
        });
    }
    else {
        addLog('log', 'Received offer text...');
        setOffer({
            type: 'offer',
            sdp: text,
        });
    }
    textToReceiveSdp.value = '';
}

// Offer側のSDPをセットする処理
async function setOffer(sessionDescription) {
    if (peerConnection) {
        addLog('error', 'peerConnection alreay exist!');
    }
    peerConnection = prepareNewConnection(false);
    try {
        await peerConnection.setRemoteDescription(sessionDescription);
        addLog('log', 'setRemoteDescription(answer) succsess in promise');
        makeAnswer();
    } catch (err) {
        addLog('error', 'setRemoteDescription ERROR: ' + err.message);
    }
}

// Answer側のSDPをセットする場合
async function setAnswer(sessionDescription) {
    if (!peerConnection) {
        addLog('error', 'peerConnection NOT exist!');
        return;
    }
    try {
        await peerConnection.setRemoteDescription(sessionDescription);
        addLog('log', 'setRemoteDescription(answer) succsess in promise');
    } catch (err) {
        addLog('error', 'setRemoteDescription(answer) ERROR: ' + err.message);
    }
}

// P2P通信を切断する
function hangUp() {
    if (peerConnection) {
        if (peerConnection.iceConnectionState !== 'closed') {
            peerConnection.close();
            peerConnection = null;
            negotiationneededCounter = 0;
            const message = JSON.stringify({ type: 'close' });
            addLog('log', 'sending close message');
            ws.send(message);
            cleanupVideoElement(remoteVideo);
            textForSendSdp.value = '';
            textToReceiveSdp.value = '';
            return;
        }
    }
    addLog('log', 'peerConnection is closed.');
}

// ビデオエレメントを初期化する
function cleanupVideoElement(element) {
    element.pause();
    element.srcObject = null;
}

function addLog(type, message) {
    message = typeof message === 'object' ? JSON.stringify(message) : message;
    const item = document.createElement('div');
    const time = document.createElement('div');
    const msg = document.createElement('div');
    item.classList.add('item');
    item.classList.add(type);
    time.classList.add('time');
    msg.classList.add('msg');
    const dt = new Date();
    time.textContent = [
        dt.getHours(), 
        dt.getMinutes(), 
        dt.getSeconds()
    ].map(n => `${n}`.padStart(2, '0')).join(':') + '.' + `${dt.getMilliseconds()}`.padStart(3, '0');
    msg.textContent = message;
    item.appendChild(time);
    item.appendChild(msg);
    //logList.insertBefore(item, logList.firstChild);
    logList.appendChild(item);
}