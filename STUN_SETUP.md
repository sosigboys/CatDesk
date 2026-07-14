# Настройка STUN/TURN сервера (coturn)

Google STUN (stun.l.google.com) в РФ заблокирован или сильно замедлен.
Для работы WebRTC через NAT нужен **свой сервер**.

## Быстрая настройка coturn на VPS

### 1. Купить VPS

Российские хостинги с Ubuntu 22.04/24.04:

| Хостинг | Цена | Примечание |
|---------|------|------------|
| TimeWeb | от 250 ₽/мес | Быстрый, дата-центры в РФ |
| VDSina | от 300 ₽/мес | Надёжный, свой API |
| Beget | от 200 ₽/мес | Популярный, простой |
| Selectel | от 400 ₽/мес | Enterprise, ЦОД в Москве/СПб |

### 2. Установить coturn

```bash
ssh root@your-server-ip

apt update && apt install coturn -y
```

### 3. Настроить

```bash
nano /etc/turnserver.conf
```

Минимальная конфигурация:

```
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=СЛУЧАЙНАЯ_СТРОКА_ДЛИННАЯ
realm=your-domain.com
total-quota=100
stale-nonce=600
log-file=/var/log/turnserver.log
no-loopback-peers
no-multicast-peers
```

### 4. Включить и запустить

```bash
# Включить в автозагрузку
systemctl enable coturn

# Отредактировать /etc/default/coturn — убрать комментарий с TURNSERVER_ENABLED=1
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

# Запустить
systemctl start coturn
systemctl status coturn
```

### 5. Открыть порты

```bash
ufw allow 3478
ufw allow 5349
ufw allow 49152:65535/udp
```

### 6. Проверить

https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

В поле STUN/TURN ввести: `stun:your-server-ip:3478`
Должен показать `srflx` кандидата.

### 7. Прописать в коде

В `renderer.js` заменить `RTC_CONFIG`:

```js
const RTC_CONFIG = {
  iceServers: [
    {
      urls: 'stun:your-server-ip:3478',
    },
  ],
};
```

## Для продакшена: TURN с авторизацией

Добавить в `/etc/turnserver.conf`:

```
user=turnuser:turnpassword
```

В коде:

```js
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:your-server-ip:3478' },
    {
      urls: [
        'turn:your-server-ip:3478?transport=udp',
        'turn:your-server-ip:3478?transport=tcp',
      ],
      username: 'turnuser',
      credential: 'turnpassword',
    },
  ],
};
```

## Бесплатный вариант (MVP)

Для локальной сети STUN не нужен — WebRTC работает через host-кандидатов.
Для тестов можно оставить `iceServers: []` — соединение будет работать
внутри одной сети (офис, дом) без интернета.
