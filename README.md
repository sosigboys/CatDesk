# 🐱 CatDesk — Remote Desktop Application / Удалённый рабочий стол

**Full-stack remote desktop solution** with custom signaling server, WebRTC P2P video, GOST encryption, and subscription management. Built from scratch as a commercial product for the Russian market.

**Полноценный удалённый рабочий стол** с собственным сигналинг-сервером, P2P-видео через WebRTC, ГОСТ-шифрованием и системой подписок. Разработан с нуля как коммерческий продукт для российского рынка.

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

---

## 🇷🇺 По-русски

### Что это и зачем

CatDesk — мой проект, который может вырости в полноценный продукт. Началось с того, что надоели лимиты RuDesktop (2 часа и отключение), а AnyDesk банят в РФ.

За два месяца написал удалённый рабочий стол с нуля: сигналинг-сервер на Node.js, десктопный клиент на Electron, P2P-видео через WebRTC3. Данные не ходят за границу.

### Что под капотом

Клиент на **Electron 33**, весь UI на ванильном JS (ни строчки React'а — осознанное решение). WebRTC для видео — пришлось повозиться с чёрным экраном в собранной версии (спойлер: GPU-кэш не мог создаться в Program Files). Ввод мыши и клавиатуры — через **PowerShell + Win32 API** (SendInput, SetCursorPos), без Python-зависимостей на проде.

Шифрование — **ГОСТ 28147-89** на чистом JavaScript. Реализовал сам: сеть Фейстеля, 32 раунда, S-box от CryptoPro, режим CTR. Не библиотека, не копипаста — писал по ГОСТу и тестовым векторам.

Серверная часть — **Node.js + WebSocket**. Свой протокол сигналинга: комнаты, пароли, обмен планами подписки, heartbeat с автоочисткой. Заодно поднял **coturn** для STUN/TURN на том же VPS.

Сайт **catdesk.ru** — PHP + MySQL. Регистрация, личный кабинет, REST API с токенами. Админка для управления пользователями и тарифами.

### Что умеет

- Полноценный удалённый доступ: вижу стол, двигаю мышь, печатаю
- Пароль на подключение — если совпал, пускает без подтверждения
- Чат и передача файлов через WebRTC DataChannel (P2P, сервер не нагружается)
- Система подписок: Free / Pro (300₽/мес) / Corporate
- Чат и файлы только для Pro и выше. Если в сессии один Pro — работает у обоих
- Обновление из приложения: проверил → скачал → установил
- Трей, автозапуск с Windows, тёмная тема
- Сплэш-заставка с котом, который бегает за клубком

### Что было самым сложным

- **Чёрный экран в установленной версии.** С `npx electron .` работало, после сборки — нет. Неделю копал. Оказалось — GPU-кэш не мог создаться из-за прав доступа. Починил переносом кэша в AppData и сменой сплэш-экрана на CSS-оверлей.
- **Двойная скобка.** Одна лишняя `{` сломала вообще всё: настройки, сеансы, disconnect. Два дня искал через скрипт подсчёта баланса скобок.
- **WebRTC через NAT.** Без STUN/TURN видео работает только локально. Поднял coturn на VPS — заработало через интернет.
- **ГОСТ-шифрование.** Написал руками. Первая версия не проходила roundtrip — перепутал правую и левую половину блока. Поправил, теперь работает.

### Почему без фреймворка

Сознательно не использовал React/Vue. Хотел понять, как всё работает на низком уровне: DOM, события, WebSocket, WebRTC.

### Стек

| Слой | Что |
|------|-----|
| Десктоп | Electron 33, чистый JS |
| UI | HTML/CSS, свой дизайн |
| Видео | WebRTC, H.264 |
| Шифрование | ГОСТ 28147-89 (ручная реализация) |
| Сервер | Node.js + ws, systemd |
| NAT | coturn (STUN/TURN) |
| Сайт | PHP 8, MySQL, ванильный JS |
| Сборка | electron-builder, NSIS |

### Ссылки

- 🌐 [catdesk.ru](https://catdesk.ru)
- 📦 [Скачать](https://catdesk.ru/CatDesk-Setup.exe)
- 👤 [GitHub](https://github.com/sosigboys)

---
