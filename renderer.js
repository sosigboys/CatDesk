window.switchSettingsTab = function(contentId, btn) {
  var tabs = document.querySelectorAll('.settings-tab');
  for (var i = 0; i < tabs.length; i++) { tabs[i].classList.remove('active'); }
  var contents = document.querySelectorAll('.settings-tab-content');
  for (var j = 0; j < contents.length; j++) { contents[j].classList.remove('active'); }
  btn.classList.add('active');
  document.getElementById(contentId).classList.add('active');
};

let SIGNALING_URL = 'ws://localhost:3000';
let RTC_CONFIG = { iceServers: [] };
let RECONNECT_DELAY = 3000;
let MAX_RECONNECT_ATTEMPTS = 5;

(function loadConfig() {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'config.json', false);
    xhr.send();
    if (xhr.status === 200) {
      var cfg = JSON.parse(xhr.responseText);
      SIGNALING_URL = cfg.signalingUrl || SIGNALING_URL;
      RTC_CONFIG = cfg.rtcConfig || RTC_CONFIG;
      RECONNECT_DELAY = cfg.reconnectDelay || RECONNECT_DELAY;
      MAX_RECONNECT_ATTEMPTS = cfg.maxReconnectAttempts || MAX_RECONNECT_ATTEMPTS;
    }
  } catch (e) { console.warn('Config not loaded'); }
})();

// State
var role = null;
var roomCode = '';
var peerConnection = null;
var dataChannel = null;
var localStream = null;
var signalingSocket = null;
var gostKey = null;
var gostReady = false;
var reconnectAttempts = 0;
var reconnectTimer = null;
var intentionalDisconnect = false;
var accessLevel = 'full';
var pendingRequest = null;

// DOM
var $ = function(id) { return document.getElementById(id); };
var mainScreen = $('mainScreen');
var viewScreen = $('viewScreen');
var remoteVideo = $('remoteVideo');
var headerStatus = $('headerStatus');
var toast = $('toast');

function showScreen(name) {
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('viewScreen').style.display = 'none';
  var target = document.getElementById(name + 'Screen');
  if (target) target.style.display = 'flex';
}

function showToast(msg, isError) {
  toast.textContent = msg;
  toast.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(function() { toast.classList.add('hidden'); }, 4000);
}

function setHeaderStatus(text, isError) {
  headerStatus.textContent = text;
  headerStatus.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)';
}

function generateRoomCode() {
  var saved = localStorage.getItem('catdesk_id');
  if (saved) return saved;
  var code = Math.floor(100000 + Math.random() * 900000).toString();
  localStorage.setItem('catdesk_id', code);
  return code;
}

// Init - auto join as host
var myRoomCode = generateRoomCode();
roomCode = myRoomCode;
$('myIdDisplay').textContent = roomCode;
window.electronAPI.updateTrayId(roomCode);
document.getElementById('hostSessionBar').classList.add('hidden'); showScreen('main');
setHeaderStatus('');

// Welcome message after login
var loginName = localStorage.getItem('catdesk_name');
if (loginName) {
  setTimeout(function() {
    showToast('Добро пожаловать, ' + loginName + '!');
  }, 3000);
}

(function autoJoin() {
  window.doJoin = function() {
    connectSignaling().then(function() {
      role = 'host';
      roomCode = myRoomCode;
      var hpw = document.getElementById('hostPassword');
      sendSignaling({ type: 'join', room: myRoomCode, role: 'host', password: hpw ? hpw.value : '' });
      setHeaderStatus('В сети');
      headerStatus.style.color = 'var(--green)';
    }).catch(function() {
      setHeaderStatus('Нет соединения', true);
      setTimeout(window.doJoin, 5000);
    });
  };
  window.doJoin();
})();

// ============================================================
// Buttons
// ============================================================
$('btnCopyId').addEventListener('click', function() {
  navigator.clipboard.writeText(roomCode).then(
    function() { showToast('ID скопирован'); },
    function() { showToast('Не удалось скопировать', true); }
  );
});

$('btnStartHost').addEventListener('click', function() {
  document.getElementById('inviteOverlay').classList.remove('hidden');
  document.getElementById('inviteTargetId').focus();
});

$('btnConnectRemote').addEventListener('click', connectToHost);
$('remoteIdInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') connectToHost();
});

// ============================================================
// Signaling
// ============================================================
function connectSignaling() {
  return new Promise(function(resolve, reject) {
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    if (signalingSocket) { try { signalingSocket.close(); } catch (_) {} }

    signalingSocket = new WebSocket(SIGNALING_URL);
    var timeout = setTimeout(function() { reject(new Error('Не удалось подключиться к серверу')); }, 5000);

    signalingSocket.onopen = function() {
      clearTimeout(timeout);
      reconnectAttempts = 0;
      intentionalDisconnect = false;
      resolve();
    };
    signalingSocket.onerror = function() { clearTimeout(timeout); reject(new Error('Не удалось подключиться к серверу')); };
    signalingSocket.onmessage = handleSignalingMessage;
    signalingSocket.onclose = function() {
      if (intentionalDisconnect) return;
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && roomCode) {
        reconnectAttempts++;
        reconnectTimer = setTimeout(function() {
          connectSignaling().then(function() {
            if (role === 'host') sendSignaling({ type: 'join', room: roomCode, role: 'host' });
            else if (role === 'client') sendSignaling({ type: 'join', room: roomCode, role: 'client' });
          }).catch(function() {});
        }, RECONNECT_DELAY);
      }
    };
  });
}

function sendSignaling(msg) {

  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    signalingSocket.send(JSON.stringify(msg));
  }
}

function handleSignalingMessage(event) {

  var msg;
  try { msg = JSON.parse(event.data); } catch (_) { return; }

  switch (msg.type) {
    case 'joined':
      break;

    case 'peer-joined':
      break;

    case 'auto-accept':
      window.acceptConnection(msg.room);
      break;

    case 'connect-request':
      showConnectionRequest(msg);
      break;

    case 'connect-response':
      handleConnectResponse(msg);
      break;

    case 'offer':
      handleOffer(msg.offer);
      break;

    case 'answer':
      handleAnswer(msg.answer);
      break;

    case 'ice-candidate':
      if (peerConnection && msg.candidate && peerConnection.remoteDescription) {
        try { peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) {}
      }
      break;

    case 'peer-left':
      showToast('Собеседник отключился', true);
      setTimeout(function() { location.reload(); }, 500);
      break;

    case 'connect-request':
      showConnectionRequest(msg);
      break;

    case 'invite':
      document.getElementById('inviteFromId').textContent = msg.fromRoom;
      document.getElementById('inviteReceivedOverlay').classList.remove('hidden');
      window.electronAPI.focusWindow();
      break;

    case 'presence': {
      var dot = document.getElementById('dot-' + msg.room);
      if (dot) {
        dot.style.background = msg.online ? 'var(--green)' : 'var(--text3)';
      }
      break;
    }

    case 'error':
      showToast(msg.message, true);
      break;
  }
}

// ============================================================
// Connection request dialog
// ============================================================
function showConnectionRequest(msg) {
 
  pendingRequest = msg;
  window._clientPassword = msg.clientPassword || '';
  window._clientPlan = msg.clientPlan || 'free';
  var myPlan = localStorage.getItem('catdesk_plan') || 'free';
  window._combinedPlan = (myPlan === 'pro' || myPlan === 'corp' || window._clientPlan === 'pro' || window._clientPlan === 'corp') ? 'pro' : 'free';
  var hpEl = document.getElementById('hostPassword');
  var hp = hpEl ? hpEl.value : '';
  var cp = window._clientPassword;
  var reqRoom = msg.room;
  window._requestRoom = reqRoom;

  if (hp && cp && hp === cp) {
    setTimeout(function() { window.acceptConnection(reqRoom); }, 200);
    return;
  }
  if (hp && cp && hp !== cp) {
    sendSignaling({ type: 'connect-response', room: reqRoom, accept: false, reason: 'Wrong password' });
    return;
  }

  $('requestIdDisplay').textContent = msg.room;
  $('requestOverlay').classList.remove('hidden');
  accessLevel = 'full';
}


$('requestReject').addEventListener('click', function() {
  $('requestOverlay').classList.add('hidden');
  sendSignaling({ type: 'connect-response', room: roomCode, accept: false });
  pendingRequest = null;
});

function addRecentSession(id) {
  try {
    var sessions = JSON.parse(localStorage.getItem('catdesk_sessions') || '[]');
    sessions = sessions.filter(function(s) { return s.id !== id; });
    sessions.unshift({ id: id, date: new Date().toLocaleString('ru'), thumb: '' });
    if (sessions.length > 20) sessions = sessions.slice(0, 20);
    localStorage.setItem('catdesk_sessions', JSON.stringify(sessions));
    loadRecentSessions();
  } catch(e) {}
}

function saveSessionThumb(id) {
  try {
    if (!remoteVideo || remoteVideo.readyState < 2) return;
    var c = document.createElement('canvas'); c.width = 160; c.height = 90;
    var ctx = c.getContext('2d'); ctx.drawImage(remoteVideo, 0, 0, 160, 90);
    var url = c.toDataURL('image/jpeg', 0.5);
    var sessions = JSON.parse(localStorage.getItem('catdesk_sessions') || '[]');
    for (var i = 0; i < sessions.length; i++) { if (sessions[i].id === id) { sessions[i].thumb = url; break; } }
    localStorage.setItem('catdesk_sessions', JSON.stringify(sessions));
    loadRecentSessions();
  } catch(e) {}
}

var pendingOffer = null;

function handleConnectResponse(msg) {
  if (msg.accept) {
    addRecentSession(roomCode);
    accessLevel = 'full';
    // Store host plan for feature gating
    var hostPlan = msg.hostPlan || 'free';
    var myPlan = localStorage.getItem('catdesk_plan') || 'free';
    window._combinedPlan = (myPlan === 'pro' || myPlan === 'corp' || hostPlan === 'pro' || hostPlan === 'corp') ? 'pro' : 'free';
    updateFeatureUI();
    createPeerConnection();
    peerConnection.ontrack = function(event) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play();
      showScreen('view');
      // Hide loading overlay
      var load = document.getElementById('videoLoading');
      if (load) load.style.display = 'none';
      setHeaderStatus('Подключено'); document.getElementById('hostSessionBar').classList.remove('hidden');
      setTimeout(function() { saveSessionThumb(roomCode); }, 3000);
    };
    // Show retry button if no video after 15s
    var _loadingTimeout = setTimeout(function() {
      var retry = document.getElementById('videoRetry');
      if (retry && !remoteVideo.srcObject) retry.style.display = '';
    }, 15000);
    peerConnection.ondatachannel = function(event) {
      
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };
    if (pendingOffer) {
      
      var po = pendingOffer;
      pendingOffer = null;
      handleOffer(po);
    }
    // Fallback: if no video after 10s, retry
    var _noVideoTimer = setTimeout(function() {
      if (!remoteVideo.srcObject) {
        tryRecover();
      }
    }, 12000);
  } else {
    showToast(msg.reason || 'В подключении отказано', true);
    disconnect();
  }
}

// ============================================================
// Host
// ============================================================
async function startHosting() {
  try {
    role = 'host';
    setHeaderStatus('Запуск...');

    var sources = await window.electronAPI.getScreenSources();
    if (!sources || sources.length === 0) {
      setHeaderStatus('Не удалось захватить экран', true);
      return;
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
          minWidth: 1280, maxWidth: 3840, minHeight: 720, maxHeight: 2160,
        },
      },
    });

    var password = $('hostPassword').value;
    sendSignaling({ type: 'join', room: roomCode, role: 'host', password: password });
    $('hostStatusBar').textContent = 'Ожидание подключения...';
    $('hostStatusBar').classList.remove('hidden');
    $('btnStartHost').textContent = 'Остановить';
    $('btnStartHost').classList.add('btn-danger-outline');
    $('btnStartHost').classList.remove('btn-primary');

    $('btnStartHost').onclick = disconnect;

    localStream.getVideoTracks()[0].onended = function() {
      showToast('Захват экрана остановлен');
      disconnect();
    };

    setHeaderStatus('Готов к подключениям');
  } catch (err) {
    console.error('Host error:', err);
    setHeaderStatus('Ошибка: ' + err.message, true);
  }
}

async function createAndSendOffer() {
  if (!peerConnection) return;
  try {
    var offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignaling({ type: 'offer', room: roomCode, offer: offer });
  } catch (err) { console.error(err); }
}

async function handleAnswer(answer) {
  if (!peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    setHeaderStatus('Подключено'); document.getElementById('hostSessionBar').classList.remove('hidden');
  } catch (err) { console.error(err); }
}

// ============================================================
// Client
// ============================================================
async function connectToHost() { 
  try {
    var remoteId = $('remoteIdInput').value.trim();
    if (!remoteId || remoteId.length < 4) { showToast('Введите ID устройства', true); return; }

    role = 'client';
    roomCode = remoteId;
    setHeaderStatus('Подключение...');

    var password = $('remotePassword').value;
    var myPlan = localStorage.getItem('catdesk_plan') || 'free';
    sendSignaling({ type: 'join', room: roomCode, role: 'client', password: password, plan: myPlan });
  } catch (err) {
    setHeaderStatus('Ошибка: ' + err.message, true);
  }
}

async function handleOffer(offer) {
  if (!peerConnection) {
    pendingOffer = offer;
    return;
  }
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    var answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendSignaling({ type: 'answer', room: roomCode, answer: answer });
  } catch (err) { console.error(err); }
}

// ============================================================
// PeerConnection
// ============================================================
function createPeerConnection() {
  if (peerConnection) { try { peerConnection.close(); } catch (_) {} }
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.onicecandidate = function(event) {
    if (event.candidate) {
      sendSignaling({ type: 'ice-candidate', room: roomCode, candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = function() {
    var state = peerConnection.connectionState;
    if (state === 'connected') {
      setHeaderStatus('Подключено'); document.getElementById('hostSessionBar').classList.remove('hidden');
    } else if (state === 'failed') {
      showToast('Соединение потеряно', true);
      setTimeout(function() { disconnect(); }, 500);
    } else if (state === 'disconnected') {
      setHeaderStatus('Переподключение...', true);
    }
  };
}

function setupDataChannel(channel) {
  channel.onopen = async function() {
    if (role === 'host') {
      gostKey = await window.electronAPI.gost.generateKey();
      gostReady = true;
      channel.send(JSON.stringify({ type: 'gost-key', key: gostKey }));
    }
  };

  channel.onmessage = function(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }

    if (msg.type === 'gost-key' && msg.key) { gostKey = msg.key; gostReady = true; return; }

    if (msg.type === 'gost-encrypted') {
      var decrypted = window.electronAPI.gost.decrypt(gostKey, msg.iv, msg.data);
      handleInputMessage(decrypted);
      return;
    }

    handleInputMessage(event.data);
  };

  channel.onclose = function() { gostReady = false; };
}

// ============================================================
// Input
// ============================================================
function handleInputMessage(data) {
  var msg;
  try { msg = JSON.parse(data); } catch (_) { return; }

  if (msg.type === 'chat' && msg.text) { addChatMessage(msg.text, false); return; }

  if (msg.type && msg.type.startsWith('file-')) { handleFileMessage(msg); return; }

  if (accessLevel === 'view' && (msg.type === 'mouse-down' || msg.type === 'mouse-up' || msg.type === 'mouse-move' || msg.type === 'mouse-wheel' || msg.type === 'key-down' || msg.type === 'key-up')) {
    return;
  }

  window.electronAPI.simulateInput(msg);
}

function sendInputEvent(type, data) {
  if (dataChannel && dataChannel.readyState === 'open') {
    var payload = JSON.stringify({ type: type, data: data });
    if (gostReady && gostKey) {
      var encrypted = window.electronAPI.gost.encrypt(gostKey, payload);
      dataChannel.send(JSON.stringify({ type: 'gost-encrypted', iv: encrypted.iv, data: encrypted.data }));
    } else {
      dataChannel.send(payload);
    }
  }
}

function getVideoPos(e) {
  var rect = remoteVideo.getBoundingClientRect();
  var vw = remoteVideo.videoWidth || rect.width;
  var vh = remoteVideo.videoHeight || rect.height;
  var scale = Math.min(rect.width / vw, rect.height / vh);
  var displayW = vw * scale;
  var displayH = vh * scale;
  var offsetX = (rect.width - displayW) / 2;
  var offsetY = (rect.height - displayH) / 2;
  return {
    x: Math.max(0, Math.min(1, (e.clientX - rect.left - offsetX) / displayW)),
    y: Math.max(0, Math.min(1, (e.clientY - rect.top - offsetY) / displayH)),
  };
}

function onInputMouseMove(e) {
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  var now = Date.now();
  if (now - lastMoveTime < 16) return;
  lastMoveTime = now;
  sendInputEvent('mouse-move', getVideoPos(e));
}

function onInputMouseDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  sendInputEvent('mouse-move', getVideoPos(e));
  sendInputEvent('mouse-down', { button: 'left' });
}

function onInputMouseUp(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  sendInputEvent('mouse-up', { button: 'left' });
}

function onInputWheel(e) {
  e.preventDefault();
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  sendInputEvent('mouse-wheel', { deltaY: -e.deltaY });
}

function onContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  sendInputEvent('mouse-move', getVideoPos(e));
  sendInputEvent('mouse-click-right', { button: 'right' });
}

function onInputKeyDown(e) {
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  e.preventDefault(); e.stopPropagation();
  sendInputEvent('key-down', { vk: e.keyCode, key: e.key, code: e.code });
}

function onInputKeyUp(e) {
  if (!dataChannel || dataChannel.readyState !== 'open') return;
  e.preventDefault(); e.stopPropagation();
  sendInputEvent('key-up', { vk: e.keyCode, key: e.key, code: e.code });
}

var lastMoveTime = 0;
remoteVideo.addEventListener('mousemove', onInputMouseMove);
remoteVideo.addEventListener('mousedown', onInputMouseDown);
remoteVideo.addEventListener('mouseup', onInputMouseUp);
remoteVideo.addEventListener('wheel', onInputWheel, { passive: false });
remoteVideo.addEventListener('contextmenu', onContextMenu);
// Keyboard handled via HTML script block

// ============================================================
// Disconnect
// ============================================================
function disconnect() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    intentionalDisconnect = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } if (_recoverTimer) { clearTimeout(_recoverTimer); _recoverTimer = null; }
  if (dataChannel) { try { dataChannel.close(); } catch (_) {} dataChannel = null; }
    if (peerConnection) { try { peerConnection.close(); } catch (_) {} peerConnection = null; }
    if (localStream) { localStream.getVideoTracks()[0].onended = null; try { localStream.getTracks().forEach(function(t) { t.stop(); }); } catch (_) {} localStream = null; }
    if (signalingSocket) {
      try { if (signalingSocket.readyState === WebSocket.OPEN) sendSignaling({ type: 'leave', room: roomCode }); signalingSocket.close(); } catch (_) {}
      signalingSocket = null;
    }
    remoteVideo.srcObject = null;
  } catch (_) {}

  document.getElementById('hostSessionBar').classList.add('hidden'); showScreen('main');
  showToast('');
  setHeaderStatus('');
  role = null;
  gostKey = null;
  gostReady = false;
  reconnectAttempts = 0;
  intentionalDisconnect = false;
  accessLevel = 'full';
  pendingRequest = null;
  window._clientPassword = '';

  $('hostStatusBar').classList.add('hidden');
  $('hostStatusBar').textContent = '';
  $('btnStartHost').textContent = 'Поделиться экраном';
  $('btnStartHost').classList.remove('btn-danger-outline');
  $('btnStartHost').classList.add('btn-primary');
  $('btnStartHost').onclick = startHosting;
  setTimeout(function() { location.reload(); }, 800);
}

// ============================================================
// Control panel
// ============================================================
var viewContainer = $('viewContainer');
var panelTimeout = null;
function showControlPanel(e) {
  if (e.clientX > 60) { hideControlPanel(); return; }
  clearTimeout(panelTimeout);
  panelTimeout = setTimeout(function() { viewContainer.classList.add('show-panel'); }, 150);
}
function hideControlPanel() {
  clearTimeout(panelTimeout);
  panelTimeout = setTimeout(function() { viewContainer.classList.remove('show-panel'); }, 800);
}
viewContainer.addEventListener('mousemove', showControlPanel);
viewContainer.addEventListener('mouseleave', hideControlPanel);

$('ctrlMouseLeft').addEventListener('click', function() {
  sendInputEvent('mouse-down', { button: 'left' });
  setTimeout(function() { sendInputEvent('mouse-up', { button: 'left' }); }, 50);
});
$('ctrlMouseRight').addEventListener('click', function() {
  sendInputEvent('mouse-click-right', { button: 'right' });
});
$('ctrlFullscreen').addEventListener('click', function() {
  if (document.fullscreenElement) { document.exitFullscreen(); }
  else { viewContainer.requestFullscreen(); }
});
$('ctrlDisconnect').addEventListener('click', disconnect);

// ============================================================
// Chat
// ============================================================
var chatPanel = $('chatPanel');
var chatMessages = $('chatMessages');
var chatInput = $('chatInput');
var chatOpen = false;

function softReset() {
  
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (dataChannel) { try { dataChannel.close(); } catch (_) {} dataChannel = null; }
  if (peerConnection) { try { peerConnection.close(); } catch (_) {} peerConnection = null; }
  if (localStream) { try { localStream.getTracks().forEach(function(t) { t.stop(); }); } catch (_) {} localStream = null; }
  remoteVideo.srcObject = null;
  gostKey = null; gostReady = false;
  document.getElementById('hostSessionBar').classList.add('hidden');
  roomCode = myRoomCode;
  accessLevel = 'full';
  pendingRequest = null;
  window._clientPassword = '';
}

function toggleChat() {
  chatOpen = !chatOpen;
  chatPanel.classList.toggle('hidden', !chatOpen);
  if (chatOpen) chatInput.focus();
}
function addChatMessage(text, local) {
  var div = document.createElement('div');
  div.className = 'chat-msg ' + (local ? 'local' : 'remote');
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function sendChatMessage() {
  var text = chatInput.value.trim();
  if (!text) return;
  if (dataChannel && dataChannel.readyState === 'open') {
    var payload = JSON.stringify({ type: 'chat', text: text });
    if (gostReady && gostKey) {
      var enc = window.electronAPI.gost.encrypt(gostKey, payload);
      dataChannel.send(JSON.stringify({ type: 'gost-encrypted', iv: enc.iv, data: enc.data }));
    } else {
      dataChannel.send(payload);
    }
    addChatMessage(text, true);
  }
  chatInput.value = '';
}
$('ctrlChat').addEventListener('click', toggleChat);
$('chatClose').addEventListener('click', toggleChat);
$('chatSend').addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChatMessage(); });


// Sync default password to host password field
var settingsDefaultPass = $('settingsDefaultPass');
if (settingsDefaultPass) {
  settingsDefaultPass.addEventListener('input', function() {
    $('hostPassword').value = settingsDefaultPass.value;
  });
}

// ============================================================
// Settings
// ============================================================
var settingsOverlay = document.getElementById("settingsOverlay");

var btnSettings = document.getElementById("btnSettings");
if (btnSettings) btnSettings.onclick = function() {
  var srv = document.getElementById("settingsServerUrl");
  if (srv) srv.value = SIGNALING_URL;
  settingsOverlay.classList.remove("hidden");
};

var btnSettingsClose = document.getElementById("settingsClose");
if (btnSettingsClose) btnSettingsClose.onclick = function() { settingsOverlay.classList.add("hidden"); };

settingsOverlay.onclick = function(e) { if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden"); };

var btnSaveServer = document.getElementById("settingsSaveServer");
if (btnSaveServer) btnSaveServer.onclick = function() {
  var srv = document.getElementById("settingsServerUrl");
  if (srv) { var u = srv.value.trim(); if (u) { SIGNALING_URL = u; showToast('Server saved'); settingsOverlay.classList.add("hidden"); } }
};

function checkForUpdatesHandler() {
  var s = document.getElementById('aboutUpdateStatus');
  if (!s) return;
  s.textContent = 'Проверяем...'; s.style.color = 'var(--text2)';
  window.electronAPI.checkForUpdates().then(function(r) {
    if (r.ok) {
      if (r.version) {
        s.innerHTML = 'Доступна версия <b>' + r.version + '</b>';
        s.style.color = 'var(--purple)';
        // Auto-download
        s.textContent = 'Скачиваю ' + r.version + '...';
        window.electronAPI.downloadUpdate(r.url);
      } else {
        s.textContent = 'У вас актуальная версия';
        s.style.color = 'var(--green)';
      }
    } else {
      s.textContent = 'Ошибка: ' + (r.message || '');
      s.style.color = 'var(--danger)';
    }
  }).catch(function() { s.textContent = 'Ошибка'; s.style.color = 'var(--danger)'; });
}

// Update progress
if (window.electronAPI.onUpdateProgress) {
  window.electronAPI.onUpdateProgress(function(pct) {
    var s = document.getElementById('aboutUpdateStatus');
    if (s) { s.textContent = 'Скачивание ' + pct + '%'; s.style.color = 'var(--purple)'; }
  });
}
if (window.electronAPI.onUpdateDownloaded) {
  window.electronAPI.onUpdateDownloaded(function() {
    var s = document.getElementById('aboutUpdateStatus');
    if (s) { 
      s.innerHTML = 'Готово! <button class="btn btn-primary btn-sm" onclick="window.electronAPI.installUpdate()" style="margin-left:8px">Установить</button>';
      s.style.color = 'var(--green)';
    }
    showToast('Обновление загружено. Нажмите Установить');
  });
}

var btnCU = document.getElementById("settingsCheckUpdates");
if (btnCU) btnCU.onclick = checkForUpdatesHandler;
var btnCU2 = document.getElementById("aboutCheckUpdates");
if (btnCU2) btnCU2.onclick = checkForUpdatesHandler;

var nb = document.getElementById("newsBlock");
if (nb) nb.textContent = 'CatDesk - remote desktop without limits. GOST encryption.';

window.quickConnect = function(id) { var i=document.getElementById("remoteIdInput"); if(i)i.value=id; connectToHost(); };
window.deleteRecent = function(id,e) { if(e)e.stopPropagation(); try{var s=JSON.parse(localStorage.getItem("catdesk_sessions")||"[]");s=s.filter(function(x){return x.id!==id});localStorage.setItem("catdesk_sessions",JSON.stringify(s));loadRecentSessions();}catch(ex){} };

function loadRecentSessions() {
  try {
    var sessions=JSON.parse(localStorage.getItem("catdesk_sessions")||"[]");
    var block=document.getElementById("recentBlock");
    if(!block)return;
    if(sessions.length===0){block.innerHTML="";return;}
    var h="";
    for(var i=0;i<Math.min(sessions.length,4);i++){var s=sessions[i];var t=s.thumb?"<img src=\""+s.thumb+"\" class=\"recent-thumb\">":"<div class=\"recent-thumb-empty\"></div>";h+="<div class=\"recent-session-card\" onclick=\"window.quickConnect('"+s.id+"')\">"+t+"<div class=\"recent-info\"><div class=\"recent-top\"><span class=\"online-dot\" id=\"dot-"+s.id+"\"></span><span class=\"recent-id\">"+s.id+"</span></div><span class=\"recent-date\">"+s.date+"</span></div><button class=\"recent-delete\" onclick=\"window.deleteRecent('"+s.id+"',event)\">x</button></div>"}
    block.innerHTML=h;
    block.style.display="flex";block.style.flexWrap="wrap";block.style.gap="8px";
    refreshOnlineStatus();
  }catch(e){}
}
loadRecentSessions();

function refreshOnlineStatus() {
  try {
    var sessions = JSON.parse(localStorage.getItem('catdesk_sessions') || '[]');
    var ids = sessions.slice(0, 10).map(function(s) { return s.id; });
    ids.forEach(function(id) { sendSignaling({ type: 'presence', room: id }); });
  } catch(e) {}
}
setInterval(refreshOnlineStatus, 10000);

window.applyLanguage = function(lang) { localStorage.setItem("catdesk_lang",lang); showToast(lang==="ru"?"Russian":"English"); };

// Auto check for updates on startup
setTimeout(function() {
  window.electronAPI.checkForUpdates().then(function(r) {
    if (r.ok && r.version) {
      showToast('Обновление ' + r.version + '...');
      window.electronAPI.downloadUpdate(r.url);
    }
  }).catch(function(){});
}, 5000);
// Account
// ============================================================
var API_URL = 'https://catdesk.ru/api.php';

function catdeskApi(route, data) {
  var opts = { method: data ? 'POST' : 'GET' };
  if (data) {
    var formBody = [];
    for (var key in data) { formBody.push(encodeURIComponent(key) + '=' + encodeURIComponent(data[key])); }
    opts.body = formBody.join('&');
    opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  }
  var token = localStorage.getItem('catdesk_token');
  if (token) {
    if (!opts.headers) opts.headers = {};
    opts.headers['Authorization'] = 'Bearer ' + token;
  }
  return fetch(API_URL + '?route=' + route, opts).then(function(r) { return r.json(); });
}

function updateAccountUI() {
  var token = localStorage.getItem('catdesk_token');
  var out = document.getElementById('accountLoggedOut');
  var in_ = document.getElementById('accountLoggedIn');
  if (!out || !in_) return;
  if (token) {
    out.style.display = 'none';
    in_.style.display = '';
    var an = document.getElementById('accountName');
    var ae = document.getElementById('accountEmailShow');
    var ap = document.getElementById('accountPlan');
    if (an) an.textContent = localStorage.getItem('catdesk_name') || '---';
    if (ae) ae.textContent = localStorage.getItem('catdesk_email') || '---';
    if (ap) ap.textContent = (localStorage.getItem('catdesk_plan') || 'free').toUpperCase();
  } else {
    out.style.display = '';
    in_.style.display = 'none';
  }
}

document.getElementById('accountLogin').addEventListener('click', function() {
  var e = document.getElementById('accountEmail').value.trim();
  var p = document.getElementById('accountPassword').value;
  var err = document.getElementById('accountError');
  if (!err) return;
  err.style.display = 'none';
  if (!e || !p) { err.textContent = 'Заполните все поля'; err.style.display = ''; return; }
  catdeskApi('login', { email: e, password: p }).then(function(r) {
    if (r.error) { err.textContent = r.error; err.style.display = ''; return; }
    localStorage.setItem('catdesk_token', r.token);
    localStorage.setItem('catdesk_name', r.user.name);
    localStorage.setItem('catdesk_email', r.user.email);
    localStorage.setItem('catdesk_plan', r.user.plan || 'free');
    localStorage.setItem('catdesk_sessions_count', r.user.sessions_count || 0);
    document.getElementById('loginSuccessOverlay').classList.remove('hidden');
    setTimeout(function() { location.reload(); }, 2000);
  }).catch(function() { err.textContent = 'Ошибка соединения'; err.style.display = ''; });
});

document.getElementById('accountLogout').addEventListener('click', function() {
  catdeskApi('logout').then(function() {
    localStorage.removeItem('catdesk_token');
    localStorage.removeItem('catdesk_name');
    localStorage.removeItem('catdesk_email');
    localStorage.removeItem('catdesk_plan');
    localStorage.removeItem('catdesk_sessions_count');
    updateAccountUI();
  });
});

updateAccountUI();

// ============================================================
// Invite system
// ============================================================
document.getElementById('inviteSend').addEventListener('click', async function() {
  var targetId = document.getElementById('inviteTargetId').value.trim();
  if (!targetId || targetId.length < 4) { showToast('Введите кэт-ID', true); return; }
  document.getElementById('inviteOverlay').classList.add('hidden');

  try {
    role = 'host';
    var sources = await window.electronAPI.getScreenSources();
    if (!sources || !sources.length) { showToast('Не удалось захватить экран', true); return; }
    localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id, minWidth: 1280, maxWidth: 3840, minHeight: 720, maxHeight: 2160 } } });

    sendSignaling({ type: 'invite', targetRoom: targetId });
    setHeaderStatus('Приглашение отправлено');
    $('hostStatusBar').textContent = 'Ожидание ответа от ' + targetId + '...';
    $('hostStatusBar').classList.remove('hidden');
    $('btnStartHost').textContent = 'Остановить';
    $('btnStartHost').classList.add('btn-danger-outline');
    $('btnStartHost').classList.remove('btn-primary');
    $('btnStartHost').onclick = disconnect;
    localStream.getVideoTracks()[0].onended = function() { disconnect(); };
  } catch(err) { showToast('Ошибка: ' + err.message, true); }
});

document.getElementById('inviteAccept').addEventListener('click', function() {
  document.getElementById('inviteReceivedOverlay').classList.add('hidden');
  var fromId = document.getElementById('inviteFromId').textContent;
  document.getElementById('remoteIdInput').value = fromId;
  connectToHost();
});

document.getElementById('inviteReject').addEventListener('click', function() {
  document.getElementById('inviteReceivedOverlay').classList.add('hidden');
});

window.acceptConnection = async function(reqRoom) {
  var r = reqRoom || window._requestRoom || roomCode;
  document.getElementById('requestOverlay').classList.add('hidden');
  if (dataChannel) { try { dataChannel.close(); } catch (_) {} dataChannel = null; }
  if (peerConnection) { try { peerConnection.close(); } catch (_) {} peerConnection = null; }
  gostKey = null; gostReady = false;
  try {
    if (!localStream || !localStream.active) {
      var s = await window.electronAPI.getScreenSources();
      if (!s || !s.length) { sendSignaling({ type: 'connect-response', room: r, accept: false }); return; }
      localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: s[0].id, minWidth: 1280, maxWidth: 3840, minHeight: 720, maxHeight: 2160 } } });
      localStream.getVideoTracks()[0].onended = function() { disconnect(); };
    }
    createPeerConnection();
    dataChannel = peerConnection.createDataChannel('input', { ordered: true });
    setupDataChannel(dataChannel);
    localStream.getTracks().forEach(function(t) { peerConnection.addTrack(t, localStream); });
    await createAndSendOffer();
    sendSignaling({ type: 'connect-response', room: r, accept: true, access: 'full', hostPlan: localStorage.getItem('catdesk_plan') || 'free' });
    document.getElementById('hostSessionBar').classList.remove('hidden');
    setHeaderStatus('Подключено');
  } catch(e) { sendSignaling({ type: 'connect-response', room: r, accept: false }); }
};
// Settings: Tray + Auto-start
document.getElementById('settingsCloseToTray').addEventListener('change', function() {
  window.electronAPI.setCloseToTray(this.checked);
});
document.getElementById('settingsAutoStart').addEventListener('change', function() {
  window.electronAPI.setAutoStart(this.checked);
});
// Load initial state
window.electronAPI.isAutoStart().then(function(r) {
  var cb = document.getElementById('settingsAutoStart');
  if (cb) cb.checked = r.enabled;
}).catch(function(){});

// Load version from app
window.electronAPI.getAppVersion().then(function(r) {
  var el = document.getElementById("aboutVersion");
  if (el) el.textContent = "v" + r.version;
}).catch(function(){});
function updateFeatureUI() {
  var plan = window._combinedPlan || 'free';
  var isPro = (plan === 'pro' || plan === 'corp');
  // Chat button in left panel
  var chatBtn = document.getElementById('ctrlChat');
  if (chatBtn) chatBtn.style.display = isPro ? '' : 'none';
  var fileBtn = document.getElementById('ctrlFile');
  if (fileBtn) fileBtn.style.display = isPro ? '' : 'none';
  // Chat in host session bar
  var chatBtns = document.querySelectorAll('#hostSessionBar button');
  for (var i = 0; i < chatBtns.length; i++) {
    if (chatBtns[i].textContent.includes('Чат')) {
      chatBtns[i].style.display = isPro ? '' : 'none';
    }
  }
}

// Call on host accept
var _origAccept = window.acceptConnection;
window.acceptConnection = async function(reqRoom) {
  updateFeatureUI();
  return _origAccept(reqRoom);
};

// ============================================================
// File transfer (P2P via DataChannel)
// ============================================================
var fileInput = document.getElementById('fileInput');
if (fileInput) {
  fileInput.addEventListener('change', function() {
    var files = this.files;
    if (!files || !files.length) return;
    for (var i = 0; i < files.length; i++) {
      sendFile(files[i]);
    }
    this.value = '';
  });
}

document.getElementById('ctrlFile').addEventListener('click', function() {
  document.getElementById('fileInput').click();
});

function sendFile(file) {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    showToast('Нет активного соединения', true);
    return;
  }
  var chunkSize = 16000;
  var offset = 0;
  var reader = new FileReader();
  
  // Send file header
  var header = JSON.stringify({ type: 'file-start', name: file.name, size: file.size });
  if (gostReady && gostKey) {
    var enc = window.electronAPI.gost.encrypt(gostKey, header);
    dataChannel.send(JSON.stringify({ type: 'gost-encrypted', iv: enc.iv, data: enc.data }));
  } else {
    dataChannel.send(header);
  }

  reader.onload = function(e) {
    if (offset >= file.size) {
      // Send end marker
      var end = JSON.stringify({ type: 'file-end', name: file.name });
      if (gostReady && gostKey) {
        var enc2 = window.electronAPI.gost.encrypt(gostKey, end);
        dataChannel.send(JSON.stringify({ type: 'gost-encrypted', iv: enc2.iv, data: enc2.data }));
      } else {
        dataChannel.send(end);
      }
      showToast('Файл отправлен: ' + file.name);
      return;
    }
    var chunk = e.target.result;
    var payload = JSON.stringify({ type: 'file-chunk', name: file.name, offset: offset, data: arrayBufferToBase64(chunk) });
    if (gostReady && gostKey) {
      var enc3 = window.electronAPI.gost.encrypt(gostKey, payload);
      dataChannel.send(JSON.stringify({ type: 'gost-encrypted', iv: enc3.iv, data: enc3.data }));
    } else {
      dataChannel.send(payload);
    }
    offset += chunk.byteLength;
    readNext();
  };

  function readNext() {
    var slice = file.slice(offset, offset + chunkSize);
    reader.readAsArrayBuffer(slice);
  }
  readNext();
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Receive file
var _fileBuffers = {};
function handleFileMessage(msg) {
  if (msg.type === 'file-start') {
    _fileBuffers[msg.name] = { size: msg.size, chunks: [], received: 0 };
    showToast('Получение файла: ' + msg.name);
  } else if (msg.type === 'file-chunk') {
    var fb = _fileBuffers[msg.name];
    if (!fb) return;
    var data = base64ToArrayBuffer(msg.data);
    fb.chunks.push(data);
    fb.received += data.byteLength;
  } else if (msg.type === 'file-end') {
    var fb = _fileBuffers[msg.name];
    if (!fb) return;
    var blob = new Blob(fb.chunks);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = msg.name;
    a.click();
    URL.revokeObjectURL(url);
    delete _fileBuffers[msg.name];
    showToast('Файл получен: ' + msg.name);
  }
}

function base64ToArrayBuffer(b64) {
  var binary = atob(b64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
