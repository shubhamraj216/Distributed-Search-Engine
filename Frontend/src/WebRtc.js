import React, { Component } from 'react';
import io from 'socket.io-client';
import Peers from './Peers';
import Query from './Query';
import Request from './Request';
import Form from './Form';

let config = {
  'iceServers': [
    {
      'url': 'stun:stun.l.google.com:19302'
    },
    {
      "urls": "turn:13.27.10.1:3000?transport=tcp",
      "username": "shubham",
      "credential": "thunderBeast"
    }
  ]
};
let socket = io('http://localhost:3000');
let myID;
let myRoom;
let opc = {};
let apc = {};
let offerChannel = {};
let sendChannel = {};

let defaultChannel = socket;
let privateChannel = socket;

let urls = ["https://google.com", "https://ebay.com",
  "https://amazon.com", "https://msn.com",
  "https://yahoo.com", "https://wikipedia.org"];


class WebRtc extends Component {
  constructor(props) {
    super(props);
    this.state = {
      active: [],
      response: [],
      request: []
    }

    this.handleQuery = this.handleQuery.bind(this);
  }

  setDefaultChannel = () => {
    defaultChannel.on('ipaddr', function (ipaddr) {
      console.log('Server IP address is: ' + ipaddr);
    });

    defaultChannel.on('created', (room) => {
      console.log('Created room', room, '- my client ID is', myID);
      this.setUpDone();
    });

    defaultChannel.on('joined', (room) => {
      console.log('This peer has joined room', room, 'with client ID', myID);
      this.setUpDone();
    });

    defaultChannel.on('full', function (room) {
      alert('Room ' + room + ' is full. We will create a new room for you.');
      window.location.hash = '';
      window.location.reload();
    });

    defaultChannel.on('log', function (array) {
      console.log.apply(console, array);
    });

    defaultChannel.on('ready', (newParticipantID) => {
      console.log('Socket is ready');
      // appender(newParticipantID, 'joined the room.', localScreen);
      this.setState(prev => ({ active: [...prev.active, newParticipantID] }));
    });

    // For creating offers and receiving answers(of offers sent).
    defaultChannel.on('message', (message) => {
      if (message.type === 'newparticipant') {
        console.log('Client received message for New Participation:', message);
        let partID = message.from;

        offerChannel[partID] = socket; // same communication channel to new participant

        offerChannel[partID].on('message', (msg) => {
          if (msg.dest === myID) {
            if (msg.type === 'answer') {
              console.log('Got Answer.')
              opc[msg.from].setRemoteDescription(new RTCSessionDescription(msg.snDescription), function () { }, this.logError);
            } else if (msg.type === 'candidate') {
              console.log('Got ICE Candidate from ' + msg.from);
              opc[msg.from].addIceCandidate(new RTCIceCandidate({
                candidate: msg.candidate,
                sdpMid: msg.id,
                sdpMLineIndex: msg.label,
              }));
            }
          }
        });
        this.createOffer(partID);
      } else if (message.type === 'bye') {
        this.ParticipationClose(message.from);
      }
    });
  }

  setPrivateChannel = () => {
    // For receiving offers or ice candidates
    privateChannel.on('message', (message) => {
      if (message.dest === myID) {
        console.log('Client received message(Offer or ICE candidate):', message);
        if (message.type === 'offer') {
          this.createAnswer(message, privateChannel, message.from);
        } else if (message.type === 'candidate') {
          apc[message.from].addIceCandidate(new RTCIceCandidate({
            candidate: message.candidate,
            sdpMid: message.id,
            sdpMLineIndex: message.label,
          }));
        }
      }
    })
  }

  joinRoom = (roomName) => {
    myRoom = roomName;
    myID = this.generateID();
    alert(`Your ID is ${myID}.`)

    console.log('My Id: ' + myID);

    this.setDefaultChannel();

    if (roomName !== '') {
      socket.emit('create or join', { room: myRoom, id: myID });
    }

    this.setPrivateChannel();

    window.onbeforeunload = function () {
      if (navigator.userAgent.indexOf("Chrome") !== -1) {
        for (let key in sendChannel) {
          if (sendChannel.hasOwnProperty(key) && sendChannel[key].readyState === 'open') {
            sendChannel[key].send(`-${myID}`);
          }
        }
      } else {
        socket.emit('message', { type: 'bye', from: myID });
      }
      return null;
    }
  }

  // when someone in room says Bye
  ParticipationClose = (from) => {
    console.log('Bye Received from client: ' + from);

    if (opc.hasOwnProperty(from)) {
      opc[from].close();
      opc[from] = null;
    }

    if (apc.hasOwnProperty(from)) {
      apc[from].close();
      apc[from] = null;
    }

    if (sendChannel.hasOwnProperty(from)) {
      delete sendChannel[from];
    }

    // appender(from, 'left the room', localScreen);
    let active = this.state.active.filter(peer => peer !== from);
    this.setState({ active: active });
  }

  // Create Offer
  createOffer = (partID) => {
    console.log('Creating an offer for: ' + partID);
    opc[partID] = new RTCPeerConnection(config);
    opc[partID].onicecandidate = (event) => {
      console.log('IceCandidate event:', event);
      if (event.candidate) {
        offerChannel[partID].emit('message', {
          type: 'candidate',
          label: event.candidate.sdpMLineIndex,
          id: event.candidate.sdpMid,
          candidate: event.candidate.candidate,
          from: myID,
          dest: partID
        });
      } else {
        console.log('End of candidates.');
      }
    };

    try {
      console.log('Creating Send Data Channel');
      sendChannel[partID] = opc[partID].createDataChannel('exchange', { reliable: false });
      this.onDataChannelCreated(sendChannel[partID], 'send');

      let LocalSession = (partID) => {
        return (sessionDescription) => {
          let channel = offerChannel[partID];

          console.log('Local Session Created: ', sessionDescription);
          opc[partID].setLocalDescription(sessionDescription, function () { }, this.logError);

          console.log('Sending Local Description: ', opc[partID].localDescription);
          channel.emit('message', { snDescription: sessionDescription, from: myID, dest: partID, type: 'offer' });
        }
      }
      opc[partID].createOffer(LocalSession(partID), this.logError);
    } catch (e) {
      console.log('createDataChannel failed with exception: ' + e);
    }
  }

  // Create Answer
  createAnswer = (msg, channel, to) => {
    console.log('Got offer. Sending answer to peer.');
    apc[to] = new RTCPeerConnection(config);
    apc[to].setRemoteDescription(new RTCSessionDescription(msg.snDescription), function () { }, this.logError);

    apc[to].ondatachannel = (event) => {
      console.log('onReceivedatachannel:', event.channel);
      sendChannel[to] = event.channel;
      this.onDataChannelCreated(sendChannel[to], 'receive');
    };

    let LocalSession = (channel) => {
      return (sessionDescription) => {
        console.log('Local Session Created: ', sessionDescription);
        apc[to].setLocalDescription(sessionDescription, function () { }, this.logError);
        console.log('Sending answer to ID: ', to);
        channel.emit('message', { snDescription: sessionDescription, from: myID, dest: to, type: 'answer' });
      }
    }
    apc[to].createAnswer(LocalSession(channel), this.logError);

    // appender(to, ' is in the room', localScreen);
    this.setState(prevState => ({ active: [...prevState.active, to] }));
  }

  // Data Channel Setup
  onDataChannelCreated = (channel, type) => {
    console.log('onDataChannelCreated:' + channel + ' with ' + type + ' state');

    channel.onopen = this.ChannelStateChangeOpen(channel);
    channel.onclose = this.ChannelStateChangeClose(channel);

    channel.onmessage = this.receiveMessage();
  }

  ChannelStateChangeClose = (channel) => {
    return () => {
      console.log('Channel closed: ' + channel);
    }
  }

  ChannelStateChangeOpen = (channel) => {
    return () => {
      console.log('Channel state: ' + channel.readyState);

      let open = this.checkOpen();
      this.enableDisable(open);
    }
  }

  // Check data channel open
  checkOpen = () => {
    let open = false;
    for (let channel in sendChannel) {
      if (sendChannel.hasOwnProperty(channel)) {
        open = (sendChannel[channel].readyState === 'open');
        if (open === true) {
          break;
        }
      }
    }
    return open;
  }

  // Enable/ Disable Buttons
  enableDisable = (open) => {
    if (open) {
      console.log('CHANNEL opened!!!');
    } else {
      console.log('CHANNEL closed!!!');
    }
  }

  // new joinee sends a message to peers for connection
  setUpDone = () => {
    console.log('Initial Setup Done ...');
    socket.emit('message', { type: 'newparticipant', from: myID }, myRoom);
  }

  receiveMessage = () => {
    let count = 0, currCount, str;
    return onmessage = (event) => {
      // console.log(event.data);
      if (event.data[0] === '-') {
        this.ParticipationClose(event.data.substr(1));
        return;
      }
      if (isNaN(event.data) === false) {
        count = parseInt(event.data);
        currCount = 0;
        str = "";
        console.log(`Expecting a total of ${count} characters.`);
        return;
      }
      if (count === 0) return;

      let data = event.data;
      str += data;
      currCount += str.length;
      console.log(str);
      console.log(`Received ${currCount} characters of data.`);

      if (currCount === count) {
        console.log(`Rendering Data`);
        console.log(str);
        this.renderMessage(str);
      }
    };
  }

  globalSend = (query) => {
    // Split message.
    let CHUNK_LEN = 4000; // 64000

    let resObj = {};
    resObj['sender'] = myID;
    resObj['type'] = 'request';
    if (query === "") {
      alert("Nothing to send");
      return;
    }
    resObj['query'] = query;
    resObj['response'] = query;

    let data = JSON.stringify(resObj);

    let len = data.length;
    let n = len / CHUNK_LEN | 0;

    if (!sendChannel) {
      alert('Connection has not been initiated. Get two peers in the same room first');
      this.logError('Connection has not been initiated. Get two peers in the same room first');
      return;
    }

    // length of data
    for (let key in sendChannel) {
      if (sendChannel.hasOwnProperty(key) && sendChannel[key].readyState === 'open') {
        console.log("Global: Sending a data of length: " + len);
        sendChannel[key].send(len);
      }
    }

    // split the text and send in chunks of about 64KB
    for (let key in sendChannel) {
      if (sendChannel.hasOwnProperty(key) && sendChannel[key].readyState === 'open') {
        for (let i = 0; i < n; i++) {
          let start = i * CHUNK_LEN,
            end = (i + 1) * CHUNK_LEN;
          console.log(start + ' - ' + (end - 1));
          sendChannel[key].send(data.substr(start, end));
        }
      }
    }

    // send the remainder
    for (let key in sendChannel) {
      if (sendChannel.hasOwnProperty(key) && sendChannel[key].readyState === 'open') {
        if (len % CHUNK_LEN) {
          console.log(n * CHUNK_LEN + ' - ' + len);
          sendChannel[key].send(data.substr(n * CHUNK_LEN));
        }
      }
    }

    console.log('Sent all Data!');
    this.renderMessage(data);
  }

  privateSend = (target, query) => {
    // Split message.
    let CHUNK_LEN = 4000; // 64000

    let resObj = {};
    resObj['sender'] = myID;
    resObj['query'] = query;
    resObj['type'] = 'response';
    resObj['response'] = this.randomx();

    let data = JSON.stringify(resObj);

    let len = data.length;
    let n = len / CHUNK_LEN | 0;

    if (!sendChannel[target]) {
      alert('Connection has not been initiated, or target is not in room.');
      this.logError('Connection has not been initiated, or target is not in room.');
      return;
    }

    // length of data
    if (sendChannel[target].readyState === 'open') {
      console.log("Private: Sending a data of length: " + len);
      sendChannel[target].send(len);
    }

    // split the text and send in chunks of about 64KB
    if (sendChannel[target].readyState === 'open') {
      for (let i = 0; i < n; i++) {
        let start = i * CHUNK_LEN,
          end = (i + 1) * CHUNK_LEN;
        console.log(start + ' - ' + (end - 1));
        sendChannel[target].send(data.substr(start, end));
      }
    }

    // send the remainder
    if (sendChannel[target].readyState === 'open') {
      if (len % CHUNK_LEN) {
        console.log(n * CHUNK_LEN + ' - ' + len);
        sendChannel[target].send(data.substr(n * CHUNK_LEN));
      }
    }

    console.log('Sent all Data!');
    // this.appender(target, query, requestScreen);
    this.setState(prevState => ({ request: [...prevState.request, { "from": target, "query": query }] }))
  }

  renderMessage = (data) => {
    let obj = JSON.parse(data);
    let type = obj.type;
    let sender = obj.sender;
    let text = obj.response;
    let query = obj.query;

    if (type === 'request') {
      // (sender === myID) && searchDB(); search your own DB
      (sender !== myID) && this.privateSend(sender, text);
    } else {
      // (sender === myID) && postResultFromDB(); post your results
      if (sender !== myID) {
        let atleast = false;
        let res = this.state.response.map(r => {
          if (r.query === query) {
            atleast = true;
            return { "query": query, "datas": [...r.datas, text] }
          }
          return r;
        })
        if (atleast) this.setState({ response: res });
        else this.setState(st => ({ response: [...st.response, { "query": query, "datas": [text] }] }))
      }
    }
  }

  // Generator for USER ID
  generateID = () => {
    let s4 = function () {
      return Math.floor(Math.random() * 0x10000).toString(16);
    };
    return s4() + '-' + s4();
  }

  logError = (err) => {
    if (!err) return;
    if (typeof err === 'string') {
      console.warn(err);
    } else {
      console.warn(err.toString(), err);
    }
  }

  randomx = () => {
    let idx = Math.floor(Math.random() * urls.length);
    return urls[idx];
  }

  componentDidMount() {
    let room = this.props.room;

    this.joinRoom(room);
  }

  handleQuery(query) {
    this.globalSend(query.query);
  }

  render() {
    return (
      <div>
        <Query queries={this.state.response} />
        <Request requests={this.state.request} />
        <Peers peers={this.state.active} />
        <Form search={this.handleQuery} />
      </div>
    );
  }
}
export default WebRtc;