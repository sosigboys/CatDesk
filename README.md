# 🐱 CatDesk — Remote Desktop Application

**Full-stack remote desktop solution** with custom signaling server, WebRTC P2P video, GOST encryption, and subscription management. Built from scratch as a commercial product for the Russian market.

![Version](https://img.shields.io/badge/version-1.0.25-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)
![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20WebRTC%20%7C%20Node.js%20%7C%20PHP-green)

---

## 🎯 Overview

CatDesk is a remote desktop application similar to AnyDesk/TeamViewer, designed for the Russian market with GOST encryption, self-hosted infrastructure, and a subscription-based business model.

**Live:** [catdesk.ru](https://catdesk.ru) | **Download:** [CatDesk-Setup.exe](https://catdesk.ru/CatDesk-Setup.exe)

## ✨ Features

| Category | Feature |
|----------|---------|
| **Remote Desktop** | Screen capture via Electron Desktop Capture API |
| **Video** | WebRTC P2P with H.264/VP8 codecs |
| **Input** | Mouse & keyboard forwarding (PowerShell SendInput on Windows) |
| **Security** | GOST 28147-89 encryption (CryptoPro S-box, CTR mode) |
| **Signaling** | Custom WebSocket server (Node.js) with rooms, heartbeat, auto-cleanup |
| **NAT Traversal** | Self-hosted STUN/TURN (coturn) |
| **Auth** | JWT-like token auth via PHP API (catdesk.ru) |
| **Subscriptions** | Free / Pro (300₽/mo) / Corporate tiers |
| **File Transfer** | P2P chunked file transfer via WebRTC DataChannel |
| **Chat** | Encrypted in-session messaging |
| **Access Control** | Password protection, approve/deny connection requests |
| **Auto-update** | Custom update checker with background download |
| **System Tray** | Minimize to tray, auto-start with Windows |
| **Admin Panel** | Web dashboard for user management and plan changes |

## 🏗 Architecture

```
┌──────────────────────┐     WebSocket      ┌──────────────────────┐
│   CatDesk Client     │ ◄───────────────► │  Signaling Server    │
│   (Electron)         │                    │  (Node.js + ws)      │
│                      │                    │  VPS: 81.177.x.x     │
│  ┌────────────────┐  │                    │  :3000               │
│  │ Renderer (JS)  │  │                    └──────────────────────┘
│  │ WebRTC + UI    │  │                             ▲
│  └────────────────┘  │                    ┌────────┴────────┐
│  ┌────────────────┐  │                    │  STUN/TURN      │
│  │ Main (Node.js) │  │                    │  (coturn :3478) │
│  │ IPC + PS input  │  │                    └─────────────────┘
│  └────────────────┘  │
└──────────────────────┘                             ▲
         │                                           │
         │  P2P (WebRTC DataChannel)                 │
         └───────────────────────────────────────────┘
                    Video + Input + Chat + Files
```

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop App** | Electron 33, vanilla JavaScript (~1000 lines) |
| **UI** | HTML5, CSS3 (dark theme, Inter font, custom design system) |
| **Real-time** | WebRTC (RTCPeerConnection + DataChannel) |
| **Video** | H.264/VP8 via Chromium codec |
| **Encryption** | Pure JS GOST 28147-89 (CTR mode, CryptoPro S-box) |
| **Input Simulation** | PowerShell + Win32 API (SendInput, SetCursorPos) |
| **Signaling Server** | Node.js + ws (WebSocket), systemd service |
| **NAT Traversal** | coturn (STUN/TURN on port 3478) |
| **Backend API** | PHP 8 + MySQL (catdesk.ru) |
| **Website** | Vanilla JS, PHP, MySQL |
| **Build** | electron-builder, NSIS installer |
| **Deployment** | FTP auto-deploy, Docker Compose |

## 📦 Project Structure

```
remote-desktop/
├── main.js              # Electron main process (window, tray, IPC, updates)
├── preload.js           # Context bridge (secure API exposure)
├── renderer.js          # UI logic + WebRTC + signaling + chat + files
├── index.html           # SPA with settings, auth, session management
├── styles.css           # Dark theme design system (300+ lines)
├── server.js            # WebSocket signaling server (production)
├── lib/
│   └── gost.js          # GOST 28147-89 block cipher (pure JS)
├── input_helper.ps1     # Windows input simulation (PowerShell)
├── config.json          # Client configuration
├── package.json         # Electron + electron-builder config
├── Dockerfile           # Signaling server Docker image
├── docker-compose.yml   # Server + nginx reverse proxy
├── DEPLOY.md            # Deployment guide
└── catdesk-site/        # Website (landing, auth, admin panel)
    ├── index.html       # Landing page
    ├── login.php        # Login page
    ├── register.php     # Registration
    ├── dashboard.php    # User dashboard
    ├── admin.php        # Admin panel
    ├── api.php          # REST API (auth, users, plans)
    └── database.sql     # Schema
```

## 🔐 GOST Encryption

All input commands (mouse, keyboard) are encrypted with **GOST 28147-89** (Russian federal standard):

- **Algorithm**: Feistel network, 64-bit blocks, 256-bit key
- **S-box**: CryptoPro (id-Gost28147-89-CryptoPro-A-ParamSet)
- **Mode**: CTR (Counter)
- **Key exchange**: Generated by host, sent via DataChannel first message
- **Implementation**: Pure JavaScript (~200 lines), no dependencies

```javascript
// lib/gost.js
const key = gost.generateKey();           // 256-bit random key
const cipher = gost.createGostCipher(key);
const encrypted = cipher.encrypt(data);   // { iv: base64, data: base64 }
const decrypted = cipher.decrypt(encrypted);
```

## 🚀 Getting Started

### Prerequisites
- Node.js 22+
- Python 3 (for development) or none (PowerShell for production)
- Windows 10/11 (PowerShell input helper)

### Development
```bash
cd remote-desktop
npm install
npm start          # Launch Electron app
node server.js     # Start signaling server (separate terminal)
```

### Production Build
```bash
npm run build:nsis   # Windows NSIS installer
npm run build:linux  # Linux RPM/AppImage
```

### Server Deployment
```bash
# VPS: Ubuntu 22.04
docker-compose up -d    # Signaling + nginx reverse proxy
# Or manually:
node server.js
```

## 📊 Business Features

- **Subscription Tiers**: Free, Pro (300₽/mo), Corporate (900₽/mo)
- **Feature Gating**: Chat & file transfer only for Pro/Corporate
- **Admin Panel**: User list, plan management, search
- **Auto-update**: Version check via catdesk.ru/version.json
- **Analytics**: Session counting, user stats

## 🛡 Security

- GOST 28147-89 encryption for all input commands
- WebRTC DTLS-SRTP for media encryption
- Password-protected connections
- Token-based authentication (catdesk.ru API)
- Self-hosted infrastructure (no third-party cloud)
- Content Security Policy in Electron renderer

## 📝 License

This project is proprietary software. All rights reserved.

---

**Built with ❤️ for the Russian market. No time limits, no foreign servers.**
