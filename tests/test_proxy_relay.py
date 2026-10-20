"""Exercise the proxy relay with local sockets, without Chrome or a database."""
import importlib.util
from pathlib import Path
import socket
import threading
import unittest


_spec = importlib.util.spec_from_file_location(
    "proxy_relay_under_test",
    Path(__file__).resolve().parents[1] / "core/browser/proxy_bridge.py",
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
ProxyBridge = _module.ProxyBridge


class _PartialWriter:
    """Model short writes and temporary socket unavailability deterministically."""

    def __init__(self, sock):
        self.sock = sock
        self.calls = 0

    def fileno(self):
        return self.sock.fileno()

    def setblocking(self, value):
        self.sock.setblocking(value)

    def recv(self, size):
        return self.sock.recv(size)

    def send(self, data):
        self.calls += 1
        if self.calls == 1:
            raise BlockingIOError()
        if self.calls == 2:
            raise InterruptedError()
        return self.sock.send(data[:997])

    def shutdown(self, how):
        self.sock.shutdown(how)


class ProxyRelayTests(unittest.TestCase):
    def transfer(self, partial_writes=False):
        bridge = ProxyBridge("127.0.0.1", 1)
        bridge._running = True
        client, relay_client = socket.socketpair()
        relay_server, server = socket.socketpair()
        for sock in (client, relay_client, relay_server, server):
            sock.settimeout(5)
        relay_server.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
        payload = bytes(range(256)) * 16384  # 4 MiB, larger than socket buffers.
        reply = b"RECEIVED:" + bytes(range(256)) * 1024
        received = bytearray()
        response = bytearray()
        errors = []
        threads = []
        writer = _PartialWriter(relay_server) if partial_writes else relay_server
        release_receiver = threading.Event()

        def run_relay():
            try:
                bridge._relay_bidirectional(relay_client, writer)
            finally:
                relay_client.close()
                relay_server.close()

        def run_server():
            try:
                # Hold off reading so an upload encounters backpressure.
                release_receiver.wait(0.2)
                while True:
                    chunk = server.recv(8192)
                    if not chunk:
                        break
                    received.extend(chunk)
                server.sendall(reply)
                server.shutdown(socket.SHUT_WR)
            except OSError as exc:
                errors.append(exc)

        def run_client():
            try:
                client.sendall(payload)
                client.shutdown(socket.SHUT_WR)
                while True:
                    chunk = client.recv(8192)
                    if not chunk:
                        break
                    response.extend(chunk)
            except OSError as exc:
                errors.append(exc)

        try:
            for target in (run_relay, run_server, run_client):
                thread = threading.Thread(target=target, daemon=True)
                threads.append(thread)
                thread.start()
            for thread in threads:
                thread.join(7)
            self.assertFalse(any(thread.is_alive() for thread in threads), "Relay stalled")
            self.assertFalse(errors, repr(errors))
            self.assertEqual(received, payload, "Upload bytes were lost or reordered")
            self.assertEqual(response, reply, "Reply was lost after upload EOF")
            if partial_writes:
                self.assertGreater(writer.calls, 2)
        finally:
            bridge._running = False
            release_receiver.set()
            for sock in (client, relay_client, relay_server, server):
                sock.close()
            for thread in threads:
                thread.join(1)

    def test_large_upload_to_slow_receiver_preserves_reply_after_eof(self):
        self.transfer()

    def test_short_writes_and_temporary_send_errors_preserve_data(self):
        self.transfer(partial_writes=True)


if __name__ == "__main__":
    unittest.main()
