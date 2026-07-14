import ctypes
import json
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

user32 = ctypes.windll.user32

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800

KEYEVENTF_KEYDOWN = 0x0000
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_EXTENDEDKEY = 0x0001


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.c_ushort),
        ("wScan", ctypes.c_ushort),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class INPUT_UNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("union", INPUT_UNION)]


VK_MAP = {
    "Enter": 0x0D, "Escape": 0x1B, "Backspace": 0x08, "Tab": 0x09,
    " ": 0x20, "Space": 0x20,
    "ArrowUp": 0x26, "ArrowDown": 0x28, "ArrowLeft": 0x25, "ArrowRight": 0x27,
    "Shift": 0x10, "ShiftLeft": 0xA0, "ShiftRight": 0xA1,
    "Control": 0x11, "ControlLeft": 0xA2, "ControlRight": 0xA3,
    "Alt": 0x12, "AltLeft": 0xA4, "AltRight": 0xA5,
    "Meta": 0x5B, "MetaLeft": 0x5B, "MetaRight": 0x5C,
    "CapsLock": 0x14, "Delete": 0x2E, "Home": 0x24, "End": 0x23,
    "PageUp": 0x21, "PageDown": 0x22, "Insert": 0x2D,
    "PrintScreen": 0x2C, "ScrollLock": 0x91, "Pause": 0x13, "NumLock": 0x90,
    "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73,
    "F5": 0x74, "F6": 0x75, "F7": 0x76, "F8": 0x77,
    "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
}


def get_vk(key_name):
    if key_name in VK_MAP:
        return VK_MAP[key_name]
    if len(key_name) == 1:
        return ord(key_name.upper())
    return 0


def send_input(events):
    n = len(events)
    arr = (INPUT * n)(*events)
    user32.SendInput(n, arr, ctypes.sizeof(INPUT))


def move_mouse(x, y):
    user32.SetCursorPos(x, y)


def mouse_down(button="left"):
    flags = {"left": MOUSEEVENTF_LEFTDOWN, "right": MOUSEEVENTF_RIGHTDOWN, "middle": MOUSEEVENTF_MIDDLEDOWN}
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.union.mi.dwFlags = flags.get(button, MOUSEEVENTF_LEFTDOWN)
    send_input([inp])


def mouse_up(button="left"):
    flags = {"left": MOUSEEVENTF_LEFTUP, "right": MOUSEEVENTF_RIGHTUP, "middle": MOUSEEVENTF_MIDDLEUP}
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.union.mi.dwFlags = flags.get(button, MOUSEEVENTF_LEFTUP)
    send_input([inp])


def key_down(key_name):
    vk = get_vk(key_name)
    if vk:
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.union.ki.wVk = vk
        inp.union.ki.dwFlags = KEYEVENTF_KEYDOWN
        send_input([inp])


def key_up(key_name):
    vk = get_vk(key_name)
    if vk:
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.union.ki.wVk = vk
        inp.union.ki.dwFlags = KEYEVENTF_KEYUP
        send_input([inp])

def key_down_vk(vk):
    if vk:
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.union.ki.wVk = int(vk)
        inp.union.ki.dwFlags = KEYEVENTF_KEYDOWN
        send_input([inp])

def key_up_vk(vk):
    if vk:
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.union.ki.wVk = int(vk)
        inp.union.ki.dwFlags = KEYEVENTF_KEYUP
        send_input([inp])


def mouse_wheel(delta):
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.union.mi.dwFlags = MOUSEEVENTF_WHEEL
    inp.union.mi.mouseData = int(delta)
    send_input([inp])


if __name__ == "__main__":
    print(json.dumps({"status": "ready"}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
            action = cmd.get("action")

            if action == "move":
                move_mouse(cmd["x"], cmd["y"])
            elif action == "mousedown":
                mouse_down(cmd.get("button", "left"))
            elif action == "mouseup":
                mouse_up(cmd.get("button", "left"))
            elif action == "wheel":
                mouse_wheel(cmd.get("delta", 0))
            elif action == "keydown":
                key_down_vk(cmd.get("vk", 0))
            elif action == "keyup":
                key_up_vk(cmd.get("vk", 0))
            elif action == "quit":
                break

            print(json.dumps({"status": "ok"}), flush=True)

        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)
