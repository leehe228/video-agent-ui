# LAN deployment

The workstation deployment uses two user services:

- `realsense-web-viewer.service`: starts the three configured RealSense D435 color streams at 424×240 and 10Hz. Scene Control can change each camera independently to 424×240, 640×360, or 640×480 at 5, 10, or 15Hz. The service persists those choices in `~/.config/video-agent-ui/camera-profiles.json` and listens only on `127.0.0.1:8765`.
- `robot-demo-site.service`: serves Workcell Console on `0.0.0.0:8080` and proxies status and camera streams from the local capture backend.

On the same LAN, open `http://192.168.10.7:8080/`.

Useful checks on the workstation:

```bash
systemctl --user status realsense-web-viewer.service robot-demo-site.service
curl http://127.0.0.1:8080/api/cameras
```

Changing one camera profile briefly reconnects only that camera. The restricted options protect the shared USB controller; do not add higher-bandwidth profiles without validating all three cameras together.
