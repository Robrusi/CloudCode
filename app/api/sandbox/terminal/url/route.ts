import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

import { refreshSandboxInactivityTimeout } from "@/lib/e2b-sandbox-timeout"

export const runtime = "nodejs"

const TERMINAL_PORT = 8766
const TERMINAL_SCRIPT = "/home/user/.cloudcode-terminal-ws.py"
const TERMINAL_LOG = "/home/user/.cloudcode-terminal-ws.log"

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

const SERVER_SCRIPT = String.raw`#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import pty
import select
import signal
import socket
import struct
import termios
import fcntl
import time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
HOST = "0.0.0.0"
PORT = 8766
REPO = "/home/user/repo"

def recv_exact(conn, size):
    data = b""
    while len(data) < size:
        chunk = conn.recv(size - len(data))
        if not chunk:
            raise ConnectionError("socket closed")
        data += chunk
    return data

def read_frame(conn):
    first = recv_exact(conn, 2)
    b1, b2 = first[0], first[1]
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack("!H", recv_exact(conn, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(conn, 8))[0]
    mask = recv_exact(conn, 4) if masked else b""
    payload = recv_exact(conn, length) if length else b""
    if masked:
        payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
    return opcode, payload

def send_frame(conn, payload, opcode=2):
    if isinstance(payload, str):
        payload = payload.encode()
    size = len(payload)
    if size < 126:
        header = bytes([0x80 | opcode, size])
    elif size < 65536:
        header = bytes([0x80 | opcode, 126]) + struct.pack("!H", size)
    else:
        header = bytes([0x80 | opcode, 127]) + struct.pack("!Q", size)
    conn.sendall(header + payload)

def set_winsize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def set_nonblocking(fd):
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

def drain_pty(conn, fd):
    while True:
        try:
            data = os.read(fd, 65536)
        except BlockingIOError:
            return True
        except OSError:
            return False
        if not data:
            return False
        send_frame(conn, data, opcode=2)

def drain_pty_briefly(conn, fd):
    deadline = time.monotonic() + 0.006
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 0)
        if fd not in readable:
            return True
        if not drain_pty(conn, fd):
            return False
    return True

def handshake(conn):
    request = b""
    while b"\r\n\r\n" not in request:
        chunk = conn.recv(4096)
        if not chunk:
            raise ConnectionError("missing websocket handshake")
        request += chunk
    headers = {}
    for line in request.decode("latin1").split("\r\n")[1:]:
        if ":" in line:
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
    key = headers.get("sec-websocket-key")
    if not key:
        raise ConnectionError("missing websocket key")
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    conn.sendall(
        (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "\r\n"
        ).encode()
    )

def handle_client(conn):
    child_pid = None
    fd = None
    try:
        try:
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass
        try:
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_QUICKACK, 1)
        except Exception:
            pass
        handshake(conn)
        child_pid, fd = pty.fork()
        if child_pid == 0:
            try:
                os.chdir(REPO if os.path.isdir(REPO) else "/home/user")
            except Exception:
                pass
            env = os.environ.copy()
            env.setdefault("TERM", "xterm-256color")
            env.setdefault("LANG", "C.UTF-8")
            env.setdefault("LC_ALL", "C.UTF-8")
            os.execvpe("/bin/bash", ["bash", "-i", "-l"], env)

        set_winsize(fd, 100, 24)
        set_nonblocking(fd)
        while True:
            readable, _, _ = select.select([conn, fd], [], [])
            if fd in readable:
                if not drain_pty(conn, fd):
                    break
            if conn in readable:
                opcode, payload = read_frame(conn)
                if opcode == 8:
                    break
                if opcode == 9:
                    send_frame(conn, payload, opcode=10)
                    continue
                if opcode == 2:
                    os.write(fd, payload)
                    if not drain_pty_briefly(conn, fd):
                        break
                elif opcode == 1:
                    try:
                        message = json.loads(payload.decode())
                        if message.get("type") == "resize":
                            set_winsize(
                                fd,
                                int(message.get("cols", 100)),
                                int(message.get("rows", 24)),
                            )
                            drain_pty_briefly(conn, fd)
                    except Exception:
                        pass
    except Exception as exc:
        try:
            send_frame(conn, str(exc), opcode=1)
        except Exception:
            pass
    finally:
        try:
            conn.close()
        except Exception:
            pass
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass
        if child_pid:
            try:
                os.kill(child_pid, signal.SIGHUP)
            except Exception:
                pass

def main():
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(50)
    while True:
        conn, _ = server.accept()
        pid = os.fork()
        if pid == 0:
            server.close()
            handle_client(conn)
            os._exit(0)
        conn.close()

if __name__ == "__main__":
    main()
`

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const info = await Sandbox.getInfo(sandboxId)
    if (info.state !== "running") {
      return NextResponse.json(
        { error: "Sandbox is paused. Resume it before opening a terminal." },
        { status: 409 }
      )
    }
    const sandbox = await Sandbox.connect(sandboxId)
    await refreshSandboxInactivityTimeout(sandbox)
    const encodedScript = Buffer.from(SERVER_SCRIPT, "utf8").toString("base64")
    const command = [
      `if python3 - <<'PY' >/dev/null 2>&1`,
      "import socket",
      `s=socket.create_connection(('127.0.0.1', ${TERMINAL_PORT}), timeout=0.2)`,
      "s.close()",
      "PY",
      "then",
      "  exit 0",
      "fi",
      `mkdir -p ${shellQuote("/home/user")}`,
      `python3 - <<'PY'`,
      "import base64",
      "from pathlib import Path",
      `Path(${JSON.stringify(TERMINAL_SCRIPT)}).write_bytes(base64.b64decode(${JSON.stringify(encodedScript)}))`,
      "PY",
      `chmod +x ${shellQuote(TERMINAL_SCRIPT)}`,
      `nohup python3 ${shellQuote(TERMINAL_SCRIPT)} > ${shellQuote(TERMINAL_LOG)} 2>&1 &`,
      `for i in $(seq 1 50); do`,
      `  (python3 - <<'PY'`,
      "import socket",
      `s=socket.create_connection(('127.0.0.1', ${TERMINAL_PORT}), timeout=0.2)`,
      "s.close()",
      "PY",
      "  ) >/dev/null 2>&1 && exit 0",
      "  sleep 0.1",
      "done",
      `cat ${shellQuote(TERMINAL_LOG)} >&2 || true`,
      "exit 1",
    ].join("\n")

    await sandbox.commands.run(`bash -lc ${shellQuote(command)}`, {
      timeoutMs: 10_000,
    })

    return NextResponse.json({
      url: `wss://${sandbox.getHost(TERMINAL_PORT)}`,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to open terminal",
      },
      { status: 500 }
    )
  }
}
