# Деплой на российский VPS за 5 минут

## Вариант 1: Docker (рекомендуется)

### 1. Купить VPS

Рекомендуемые хостинги РФ (Ubuntu 22.04/24.04):

| Хостинг | Мин. тариф | Ссылка |
|---------|-----------|--------|
| TimeWeb | 250 ₽/мес | timeweb.com |
| VDSina | 300 ₽/мес | vdsina.ru |
| Beget | 200 ₽/мес | beget.com |
| Selectel | 400 ₽/мес | selectel.ru |

### 2. Подключиться и установить Docker

```bash
ssh root@<ваш-ip>

curl -fsSL https://get.docker.com | sh
apt install docker-compose -y
```

### 3. Загрузить проект на сервер

```bash
# На своём ПК упаковать:
cd C:\Users\sem\Desktop\remote-desktop
tar --exclude=node_modules --exclude=.git -czf deploy.tar.gz server.js package.json package-lock.json Dockerfile docker-compose.yml nginx.conf

# Отправить на сервер:
scp deploy.tar.gz root@<ваш-ip>:/root/

# На сервере:
cd /root
tar -xzf deploy.tar.gz -C /opt/remote-desktop/
cd /opt/remote-desktop
```

### 4. Настроить домен и HTTPS (если есть домен)

```bash
apt install certbot -y

# Получить сертификат
certbot certonly --standalone -d your-domain.com

# Скопировать в certs/
mkdir -p certs
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem certs/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem certs/
```

### 5. Запустить

```bash
docker-compose up -d --build
docker-compose ps
```

Сервер запущен:
- Сигналинг: `ws://<ваш-ip>:3000/ws`
- WSS (если настроен домен): `wss://your-domain.com/ws`

### 6. Обновить config.json в клиенте

В `config.json` на своём ПК заменить:

```json
{
  "signalingUrl": "ws://<ваш-ip>:3000"
}
```

Или с доменом:

```json
{
  "signalingUrl": "wss://your-domain.com/ws"
}
```

---

## Вариант 2: Без Docker (Node.js напрямую)

### 1. Установить Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install nodejs -y
```

### 2. Загрузить и запустить

```bash
cd /opt/remote-desktop
cp config.prod.json config.json   # если нужен
npm ci --omit=dev
node server.js
```

### 3. Systemd-сервис для автозапуска

```bash
cat > /etc/systemd/system/remotedesk-signaling.service << 'EOF'
[Unit]
Description=Remote Desktop Signaling Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/remote-desktop
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable remotedesk-signaling
systemctl start remotedesk-signaling
systemctl status remotedesk-signaling
```

---

## Вариант 3: STUN/TURN сервер (coturn)

Если нужна работа через любой NAT (клиенты за разными роутерами):

```bash
apt install coturn -y

cat > /etc/turnserver.conf << 'EOF'
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
user=turnuser:CHANGE_ME_STRONG_PASSWORD
realm=your-domain.com
log-file=/var/log/turnserver.log
no-loopback-peers
no-multicast-peers
EOF

# Открыть порты
ufw allow 3478
ufw allow 5349
ufw allow 49152:65535/udp

# Включить
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn
systemctl start coturn
```

После — прописать в `config.json` клиента:

```json
{
  "rtcConfig": {
    "iceServers": [
      { "urls": "stun:<ваш-ip>:3478" },
      {
        "urls": ["turn:<ваш-ip>:3478?transport=udp", "turn:<ваш-ip>:3478?transport=tcp"],
        "username": "turnuser",
        "credential": "CHANGE_ME_STRONG_PASSWORD"
      }
    ]
  }
}
```

---

## Проверка работоспособности

```bash
# Проверить сигналинг
curl http://<ваш-ip>:3000/
# Ответ: {"status":"ok","uptime":...}

# Проверить WebSocket
wscat -c ws://<ваш-ip>:3000
> {"type":"join","room":"123456","role":"host"}
# Ответ: {"type":"joined","room":"123456","role":"host"}
```
