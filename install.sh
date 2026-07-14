#!/bin/bash
set -e

echo "=== RemoteDesk: Установка сигналинг-сервера ==="

# Node.js 22
if ! command -v node &> /dev/null; then
    echo "[1/4] Устанавливаю Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install nodejs -y
else
    echo "[1/4] Node.js уже установлен: $(node --version)"
fi

# Папка
APP_DIR="/opt/remotedesk"
mkdir -p "$APP_DIR"

# Копируем файлы сервера (должны быть в текущей папке)
echo "[2/4] Копирую файлы сервера..."
cp server.js package.json "$APP_DIR/"
cd "$APP_DIR"

# Зависимости
echo "[3/4] Устанавливаю зависимости..."
npm install --omit=dev

# Systemd-сервис
echo "[4/4] Создаю systemd-сервис..."
cat > /etc/systemd/system/remotedesk-signaling.service << 'SVC'
[Unit]
Description=RemoteDesk Signaling Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/remotedesk
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable remotedesk-signaling
systemctl restart remotedesk-signaling

# Файрвол
ufw allow 3000/tcp
ufw allow 22/tcp
ufw --force enable

echo ""
echo "=== Готово ==="
echo "Сервер:          ws://$(curl -s ifconfig.me):3000"
echo "Проверка:        curl http://localhost:3000"
echo "Статус:          systemctl status remotedesk-signaling"
echo "Логи:            journalctl -u remotedesk-signaling -f"
