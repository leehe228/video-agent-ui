#!/usr/bin/env python3
"""Serve Intel RealSense color streams as a local MJPEG dashboard.

The runtime intentionally uses only the Python standard library for HTTP.  The
camera backend imports pyrealsense2, OpenCV, and NumPy lazily so status and unit
tests still work on machines without RealSense hardware.
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import json
import mimetypes
import os
import signal
import socket
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Iterable, Protocol
from urllib.parse import unquote, urlsplit


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

# Small valid JPEG used while a camera is missing or reconnecting.  The UI
# overlays the actionable camera state, so this frame deliberately stays plain.
PLACEHOLDER_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIs"
    "IxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAA"
    "AAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAk"
    "M2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKT"
    "lJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QA"
    "HwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdh"
    "cRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp"
    "anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk"
    "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDweiiipA//2Q=="
)


@dataclasses.dataclass(frozen=True)
class DeviceInfo:
    serial: str
    name: str
    product_line: str = ""
    usb_type: str = ""


@dataclasses.dataclass(frozen=True)
class StreamConfig:
    width: int = 640
    height: int = 480
    fps: int = 15
    jpeg_quality: int = 78


ALLOWED_RESOLUTIONS = ((424, 240), (640, 360), (640, 480))
ALLOWED_FPS = (5, 10, 15)


def validate_stream_config(config: StreamConfig) -> None:
    if (config.width, config.height) not in ALLOWED_RESOLUTIONS:
        raise ValueError("unsupported camera resolution")
    if config.fps not in ALLOWED_FPS:
        raise ValueError("unsupported camera frame rate")


class CameraBackend(Protocol):
    def discover(self) -> list[DeviceInfo]: ...

    def capture(
        self,
        serial: str,
        config: StreamConfig,
        stop_event: threading.Event,
        on_connected: Callable[[int, int, int], None],
        on_frame: Callable[[bytes], None],
    ) -> None: ...


class RealSenseBackend:
    """pyrealsense2 capture backend with profile negotiation."""

    def __init__(self) -> None:
        try:
            import cv2  # type: ignore
            import numpy as np  # type: ignore
            import pyrealsense2 as rs  # type: ignore
        except ImportError as exc:  # pragma: no cover - hardware host only
            raise RuntimeError(
                "RealSense runtime missing. Run with /usr/bin/python3 and install "
                "pyrealsense2, python3-opencv, and python3-numpy."
            ) from exc
        self.cv2 = cv2
        self.np = np
        self.rs = rs

    @staticmethod
    def _info(device: object, key: object) -> str:
        try:
            if device.supports(key):
                return str(device.get_info(key))
        except Exception:
            pass
        return ""

    def discover(self) -> list[DeviceInfo]:
        rs = self.rs
        devices: list[DeviceInfo] = []
        for device in rs.context().query_devices():
            serial = self._info(device, rs.camera_info.serial_number)
            if not serial:
                continue
            devices.append(
                DeviceInfo(
                    serial=serial,
                    name=self._info(device, rs.camera_info.name) or "Intel RealSense",
                    product_line=self._info(device, rs.camera_info.product_line),
                    usb_type=self._info(device, rs.camera_info.usb_type_descriptor),
                )
            )
        return sorted(devices, key=lambda item: item.serial)

    def _select_color_profile(self, serial: str, wanted: StreamConfig) -> tuple[int, int, int, object]:
        rs = self.rs
        try:
            device = next(
                (
                    candidate
                    for candidate in rs.context().query_devices()
                    if self._info(candidate, rs.camera_info.serial_number) == serial
                ),
                None,
            )
        except Exception:
            # A broken camera on the same host can make librealsense discovery
            # fail even though a configured camera can still be opened by its
            # serial. Try the requested profile directly in that case.
            return wanted.width, wanted.height, wanted.fps, rs.format.bgr8
        if device is None:
            raise RuntimeError(f"camera {serial} is not currently detected")

        preferred_formats = [rs.format.bgr8, rs.format.rgb8, rs.format.yuyv]
        candidates: list[tuple[int, int, int, int, object]] = []
        for sensor in device.query_sensors():
            for profile in sensor.get_stream_profiles():
                try:
                    if profile.stream_type() != rs.stream.color:
                        continue
                    video = profile.as_video_stream_profile()
                    fmt = profile.format()
                    if fmt not in preferred_formats:
                        continue
                    # Prefer the nearest profile at or above the requested
                    # delivery rate. A slower hardware profile can never be
                    # paced up to the requested browser frame rate.
                    fps_delta = profile.fps() - wanted.fps
                    fps_penalty = abs(fps_delta) if fps_delta >= 0 else abs(fps_delta) + 1000
                    score = (
                        abs(video.width() - wanted.width) * 4
                        + abs(video.height() - wanted.height) * 4
                        + fps_penalty * 20
                        + preferred_formats.index(fmt)
                    )
                    candidates.append((score, video.width(), video.height(), profile.fps(), fmt))
                except Exception:
                    continue
        if not candidates:
            raise RuntimeError(f"camera {serial} exposes no supported color stream")
        _, width, height, fps, fmt = min(candidates, key=lambda item: item[0])
        return width, height, fps, fmt

    def capture(
        self,
        serial: str,
        config: StreamConfig,
        stop_event: threading.Event,
        on_connected: Callable[[int, int, int], None],
        on_frame: Callable[[bytes], None],
    ) -> None:
        rs, cv2, np = self.rs, self.cv2, self.np
        width, height, fps, fmt = self._select_color_profile(serial, config)
        pipeline = rs.pipeline()
        rs_config = rs.config()
        rs_config.enable_device(serial)
        rs_config.enable_stream(rs.stream.color, width, height, fmt, fps)
        started = False
        try:
            pipeline.start(rs_config)
            started = True
            connected = False
            consecutive_timeouts = 0
            delivery_interval = 1.0 / config.fps
            next_delivery_at = time.monotonic()
            while not stop_event.is_set():
                try:
                    frames = pipeline.wait_for_frames(timeout_ms=1500)
                except RuntimeError as exc:
                    if "Frame didn't arrive" in str(exc):
                        consecutive_timeouts += 1
                        if consecutive_timeouts >= 4:
                            raise RuntimeError("no color frames received for 6 seconds") from exc
                        continue
                    raise
                color = frames.get_color_frame()
                if not color:
                    continue
                consecutive_timeouts = 0
                if not connected:
                    on_connected(width, height, config.fps)
                    connected = True
                now = time.monotonic()
                if now < next_delivery_at:
                    continue
                while next_delivery_at <= now:
                    next_delivery_at += delivery_interval
                image = np.asanyarray(color.get_data())
                if fmt == rs.format.rgb8:
                    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
                elif fmt == rs.format.yuyv:
                    image = cv2.cvtColor(image, cv2.COLOR_YUV2BGR_YUY2)
                ok, encoded = cv2.imencode(
                    ".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), config.jpeg_quality]
                )
                if not ok:
                    raise RuntimeError("OpenCV failed to encode a camera frame")
                on_frame(encoded.tobytes())
        finally:
            if started:
                try:
                    pipeline.stop()
                except Exception:
                    pass


class CameraSlot:
    def __init__(self, index: int) -> None:
        self.index = index
        self.serial = ""
        self.name = ""
        self.product_line = ""
        self.usb_type = ""
        self.status = "waiting"
        self.error = "Waiting for a RealSense device"
        self.width = 0
        self.height = 0
        self.target_fps = 0
        self.measured_fps = 0.0
        self.frames = 0
        self.last_frame_at = 0.0
        self._fps_window_start = 0.0
        self._fps_window_frames = 0
        self._jpeg: bytes | None = None
        self._sequence = 0
        self._condition = threading.Condition()

    def assign(self, device: DeviceInfo) -> None:
        with self._condition:
            self.serial = device.serial
            self.name = device.name
            self.product_line = device.product_line
            self.usb_type = device.usb_type
            self.status = "connecting"
            self.error = "Opening camera stream"
            self._condition.notify_all()

    def set_connecting(self, error: str = "Opening camera stream") -> None:
        with self._condition:
            self.status = "connecting"
            self.error = error
            self._condition.notify_all()

    def set_connected(self, width: int, height: int, fps: int) -> None:
        with self._condition:
            self.status = "live"
            self.error = ""
            self.width, self.height, self.target_fps = width, height, fps
            self._fps_window_start = time.monotonic()
            self._fps_window_frames = 0
            self._condition.notify_all()

    def set_offline(self, error: str) -> None:
        with self._condition:
            self.status = "offline"
            self.error = error.strip().replace("\n", " ")[:240]
            self.measured_fps = 0.0
            self._condition.notify_all()

    def publish(self, jpeg: bytes) -> None:
        now = time.monotonic()
        with self._condition:
            self._jpeg = jpeg
            self._sequence += 1
            self.frames += 1
            self.last_frame_at = time.time()
            self.status = "live"
            self.error = ""
            self._fps_window_frames += 1
            elapsed = now - self._fps_window_start
            if elapsed >= 1.0:
                self.measured_fps = self._fps_window_frames / elapsed
                self._fps_window_start = now
                self._fps_window_frames = 0
            self._condition.notify_all()

    def wait_for_frame(self, after_sequence: int, timeout: float) -> tuple[bytes, int]:
        with self._condition:
            if self._sequence == after_sequence:
                self._condition.wait(timeout)
            return self._jpeg or PLACEHOLDER_JPEG, self._sequence

    def snapshot(self) -> dict[str, object]:
        with self._condition:
            status = self.status
            age = time.time() - self.last_frame_at if self.last_frame_at else None
            if status == "live" and age is not None and age > 4.0:
                status = "stale"
            return {
                "slot": self.index,
                "assigned": bool(self.serial),
                "serial": self.serial,
                "name": self.name,
                "product_line": self.product_line,
                "usb_type": self.usb_type,
                "status": status,
                "error": self.error,
                "width": self.width,
                "height": self.height,
                "target_fps": self.target_fps,
                "fps": round(self.measured_fps, 1),
                "frames": self.frames,
                "last_frame_age_s": round(age, 1) if age is not None else None,
            }


class CameraManager:
    def __init__(
        self,
        backend: CameraBackend,
        config: StreamConfig,
        slot_count: int = 3,
        configured_serials: Iterable[str] = (),
        discovery_interval: float = 2.0,
        profile_state_path: Path | None = None,
    ) -> None:
        self.backend = backend
        self.slots = [CameraSlot(index) for index in range(slot_count)]
        self.configs = [config for _ in range(slot_count)]
        self.configured_serials = [value.strip() for value in configured_serials if value.strip()]
        if len(self.configured_serials) > slot_count:
            raise ValueError(f"at most {slot_count} configured serials are allowed")
        self.discovery_interval = discovery_interval
        self.profile_state_path = profile_state_path
        self.stop_event = threading.Event()
        self._supervisor: threading.Thread | None = None
        self._workers: dict[int, tuple[threading.Thread, threading.Event]] = {}
        self._workers_lock = threading.Lock()
        self._update_lock = threading.Lock()
        self._lock = threading.Lock()
        self._detected: dict[str, DeviceInfo] = {}
        self._backend_error = ""

        for index, serial in enumerate(self.configured_serials):
            self.slots[index].assign(DeviceInfo(serial=serial, name="Configured RealSense"))
        self._load_profile_state()

    def _load_profile_state(self) -> None:
        if not self.profile_state_path or not self.profile_state_path.is_file():
            return
        try:
            payload = json.loads(self.profile_state_path.read_text(encoding="utf-8"))
            profiles = payload.get("slots", [])
            for index, profile in enumerate(profiles[: len(self.configs)]):
                config = StreamConfig(
                    width=int(profile["width"]),
                    height=int(profile["height"]),
                    fps=int(profile["fps"]),
                    jpeg_quality=self.configs[index].jpeg_quality,
                )
                validate_stream_config(config)
                self.configs[index] = config
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            self._backend_error = f"Ignoring invalid profile state: {exc}"[:240]

    def _save_profile_state(self) -> None:
        if not self.profile_state_path:
            return
        payload = {
            "slots": [
                {"width": config.width, "height": config.height, "fps": config.fps}
                for config in self.configs
            ]
        }
        self.profile_state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.profile_state_path.with_suffix(self.profile_state_path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.profile_state_path)

    def start(self) -> None:
        if self._supervisor and self._supervisor.is_alive():
            return
        self._supervisor = threading.Thread(target=self._supervise, name="camera-supervisor", daemon=True)
        self._supervisor.start()

    def stop(self) -> None:
        self.stop_event.set()
        with self._workers_lock:
            worker_states = list(self._workers.values())
        for _, worker_stop_event in worker_states:
            worker_stop_event.set()
        if self._supervisor:
            self._supervisor.join(timeout=4)
        for worker, _ in worker_states:
            worker.join(timeout=3)

    def _supervise(self) -> None:
        while not self.stop_event.is_set():
            # Configured cameras do not depend on global USB discovery. This is
            # important when one unhealthy RealSense makes query_devices fail
            # for every device on the host.
            self._start_assigned_workers()
            try:
                # USB enumeration order is not stable across boots or reconnects.
                # Sort again here even if a backend already returns sorted data.
                devices = sorted(self.backend.discover(), key=lambda device: device.serial)
                detected = {device.serial: device for device in devices}
                with self._lock:
                    self._detected = detected
                    self._backend_error = ""
                assigned = {slot.serial for slot in self.slots if slot.serial}
                for device in devices:
                    if device.serial in assigned:
                        slot = next(slot for slot in self.slots if slot.serial == device.serial)
                        slot.name = device.name
                        slot.product_line = device.product_line
                        slot.usb_type = device.usb_type
                        continue
                    empty = next((slot for slot in self.slots if not slot.serial), None)
                    if empty is None:
                        break
                    empty.assign(device)
                    assigned.add(device.serial)
                self._start_assigned_workers()
            except Exception as exc:
                with self._lock:
                    self._backend_error = str(exc)[:240]
            self.stop_event.wait(self.discovery_interval)

    def _start_assigned_workers(self, stagger: bool = True) -> None:
        for slot in self.slots:
            if not slot.serial:
                continue
            with self._workers_lock:
                if slot.index in self._workers:
                    continue
                worker_stop_event = threading.Event()
                worker = threading.Thread(
                    target=self._capture_loop,
                    args=(slot, worker_stop_event),
                    name=f"camera-{slot.index + 1}-{slot.serial}",
                    daemon=True,
                )
                self._workers[slot.index] = (worker, worker_stop_event)
            worker.start()
            # Starting several D435 pipelines simultaneously can overwhelm a
            # shared USB hub during UVC negotiation. Stagger startup so each
            # camera has time to finish enumerating before the next opens.
            if stagger:
                self.stop_event.wait(2.0)

    def _capture_loop(self, slot: CameraSlot, worker_stop_event: threading.Event) -> None:
        retry_delay = 1.0
        while not self.stop_event.is_set() and not worker_stop_event.is_set():
            slot.set_connecting()
            try:
                config = self.configs[slot.index]
                self.backend.capture(
                    slot.serial,
                    config,
                    worker_stop_event,
                    slot.set_connected,
                    slot.publish,
                )
                retry_delay = 1.0
            except Exception as exc:
                if worker_stop_event.is_set() or self.stop_event.is_set():
                    break
                slot.set_offline(str(exc))
                worker_stop_event.wait(retry_delay)
                retry_delay = min(retry_delay * 1.7, 8.0)

    def update_slot_config(self, slot_index: int, config: StreamConfig) -> dict[str, object]:
        if not 0 <= slot_index < len(self.slots):
            raise IndexError("camera slot not found")
        validate_stream_config(config)
        with self._update_lock:
            current = self.configs[slot_index]
            config = dataclasses.replace(config, jpeg_quality=current.jpeg_quality)
            if config == current:
                return self.camera_snapshot(slot_index)

            with self._workers_lock:
                worker_state = self._workers.get(slot_index)
            if worker_state:
                worker, worker_stop_event = worker_state
                worker_stop_event.set()
                worker.join(timeout=5)
                if worker.is_alive():
                    raise RuntimeError("camera did not stop in time")
                with self._workers_lock:
                    if self._workers.get(slot_index) == worker_state:
                        self._workers.pop(slot_index, None)

            self.configs[slot_index] = config
            try:
                self._save_profile_state()
            except OSError as exc:
                with self._lock:
                    self._backend_error = f"Unable to persist camera profiles: {exc}"[:240]
            self.slots[slot_index].set_connecting(
                f"Applying {config.width}x{config.height} at {config.fps}Hz"
            )
            self._start_assigned_workers(stagger=False)
            return self.camera_snapshot(slot_index)

    def camera_snapshot(self, slot_index: int) -> dict[str, object]:
        camera = self.slots[slot_index].snapshot()
        config = self.configs[slot_index]
        camera.update(
            {
                "requested_width": config.width,
                "requested_height": config.height,
                "requested_fps": config.fps,
            }
        )
        return camera

    def snapshot(self) -> dict[str, object]:
        camera_states = [self.camera_snapshot(slot.index) for slot in self.slots]
        with self._lock:
            detected = list(self._detected.values())
            backend_error = self._backend_error
        return {
            "ok": not backend_error,
            "backend_error": backend_error,
            "expected_count": len(self.slots),
            "detected_count": len(detected),
            "online_count": sum(camera["status"] == "live" for camera in camera_states),
            "detected_devices": [dataclasses.asdict(device) for device in detected],
            "profile_options": {
                "resolutions": [
                    {"width": width, "height": height} for width, height in ALLOWED_RESOLUTIONS
                ],
                "fps": list(ALLOWED_FPS),
            },
            "cameras": camera_states,
            "timestamp": time.time(),
        }


class ViewerHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], manager: CameraManager, static_dir: Path = STATIC_DIR):
        super().__init__(address, ViewerRequestHandler)
        self.manager = manager
        self.static_dir = static_dir.resolve()


class ViewerRequestHandler(BaseHTTPRequestHandler):
    server: ViewerHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}", flush=True)

    def do_GET(self) -> None:  # noqa: N802
        path = unquote(urlsplit(self.path).path)
        if path in ("/", "/index.html"):
            self._serve_file(self.server.static_dir / "index.html")
        elif path.startswith("/static/"):
            self._serve_static(path.removeprefix("/static/"))
        elif path == "/api/status":
            self._send_json(self.server.manager.snapshot())
        elif path == "/api/health":
            snapshot = self.server.manager.snapshot()
            self._send_json(
                {
                    "ok": snapshot["ok"],
                    "online_count": snapshot["online_count"],
                    "detected_count": snapshot["detected_count"],
                    "expected_count": snapshot["expected_count"],
                }
            )
        elif path.startswith("/stream/") and path.endswith(".mjpg"):
            self._serve_stream(path)
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self) -> None:  # noqa: N802
        path = unquote(urlsplit(self.path).path)
        parts = path.strip("/").split("/")
        if len(parts) != 4 or parts[:2] != ["api", "cameras"] or parts[3] != "config":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            slot_index = int(parts[2])
            content_length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= content_length <= 4096:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(content_length))
            current = self.server.manager.configs[slot_index]
            config = StreamConfig(
                width=int(payload["width"]),
                height=int(payload["height"]),
                fps=int(payload["fps"]),
                jpeg_quality=current.jpeg_quality,
            )
            camera = self.server.manager.update_slot_config(slot_index, config)
        except (IndexError, KeyError):
            self._send_json({"ok": False, "error": "camera slot not found"}, HTTPStatus.NOT_FOUND)
            return
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        except RuntimeError as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.CONFLICT)
            return
        self._send_json({"ok": True, "camera": camera})

    def _serve_static(self, relative: str) -> None:
        target = (self.server.static_dir / relative).resolve()
        if not target.is_relative_to(self.server.static_dir):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        self._serve_file(target)

    def _serve_file(self, target: Path) -> None:
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def _send_json(
        self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK
    ) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.end_headers()
        self.wfile.write(content)

    def _serve_stream(self, path: str) -> None:
        try:
            slot_index = int(path.removeprefix("/stream/").removesuffix(".mjpg"))
            slot = self.server.manager.slots[slot_index]
        except (ValueError, IndexError):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        sequence = -1
        try:
            while not self.server.manager.stop_event.is_set():
                frame, new_sequence = slot.wait_for_frame(sequence, timeout=1.0)
                sequence = new_sequence
                self.wfile.write(b"--frame\r\n")
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii"))
                self.wfile.write(frame)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass


def parse_serials(raw: str) -> list[str]:
    return [value.strip() for value in raw.split(",") if value.strip()]


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default=os.getenv("RS_BIND", "127.0.0.1"))
    parser.add_argument("--port", type=positive_int, default=int(os.getenv("RS_PORT", "8765")))
    parser.add_argument("--width", type=positive_int, default=int(os.getenv("RS_WIDTH", "640")))
    parser.add_argument("--height", type=positive_int, default=int(os.getenv("RS_HEIGHT", "480")))
    parser.add_argument("--fps", type=positive_int, default=int(os.getenv("RS_FPS", "15")))
    parser.add_argument(
        "--slots",
        type=positive_int,
        default=int(os.getenv("RS_SLOTS", "3")),
        help="number of camera slots to show (default: 3)",
    )
    parser.add_argument(
        "--jpeg-quality", type=positive_int, default=int(os.getenv("RS_JPEG_QUALITY", "78"))
    )
    parser.add_argument(
        "--serials",
        default=os.getenv("RS_SERIALS", ""),
        help="comma-separated serials in Camera 1/2/3 order",
    )
    parser.add_argument(
        "--profile-state",
        default=os.getenv("RS_PROFILE_STATE", ""),
        help="JSON file used to persist per-camera profiles",
    )
    parser.add_argument("--list", action="store_true", help="list detected devices and exit")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not 1 <= args.jpeg_quality <= 100:
        raise SystemExit("--jpeg-quality must be in the range 1..100")
    initial_config = StreamConfig(args.width, args.height, args.fps, args.jpeg_quality)
    try:
        validate_stream_config(initial_config)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    backend = RealSenseBackend()
    if args.list:
        devices = backend.discover()
        if not devices:
            print("No Intel RealSense devices detected")
            return 1
        for index, device in enumerate(devices, start=1):
            print(
                f"{index}: {device.name} serial={device.serial} "
                f"product_line={device.product_line or '-'} usb={device.usb_type or '-'}"
            )
        return 0

    manager = CameraManager(
        backend=backend,
        config=initial_config,
        slot_count=args.slots,
        configured_serials=parse_serials(args.serials),
        profile_state_path=Path(args.profile_state).expanduser() if args.profile_state else None,
    )
    server = ViewerHTTPServer((args.bind, args.port), manager)

    def request_shutdown(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)
    manager.start()
    print(f"RealSense viewer: http://{args.bind}:{args.port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.4)
    finally:
        server.server_close()
        manager.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
