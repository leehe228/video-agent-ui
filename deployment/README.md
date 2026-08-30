# LAN deployment

The workstation deployment uses two user services:

- `realsense-web-viewer.service`: captures the three configured RealSense D435 color streams at 424×240 and paces MJPEG delivery to 10Hz. It also exposes 424×240 depth previews at 5Hz for the in-page PIP overlays. This profile limits shared USB-controller load. It listens only on `127.0.0.1:8765`.
- `robot-demo-site.service`: serves Workcell Console on `0.0.0.0:8080` and proxies status and camera streams from the local capture backend.

On the same LAN, open `http://192.168.10.7:8080/`.

Useful checks on the workstation:

```bash
systemctl --user status realsense-web-viewer.service robot-demo-site.service
curl http://127.0.0.1:8080/api/cameras
```
