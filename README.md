# CloudTAK-DJI

> **⚠️ Work in progress.** This is a basic [DJI Cloud API][dji-cloud] compliant
> bridge that lets DJI Pilot 2 / RC Plus log in with CloudTAK credentials,
> stream live UAS telemetry into a CloudTAK-style web UI, and start/stop
> live video for selected aircraft.

## What it does

```
DJI Pilot 2 ──► /manage/api/v1/iam/login ──► federates to CloudTAK login
       │                                              │
       │                                              ▼
       │                                       JWT (wraps CloudTAK token)
       ▼
   MQTT broker (Thing-Model topics)
       │
       ▼
   CloudTAK-DJI server  ──► /api/sse/device  ──►  Web UI (live OSD + HLS video)
       │
       └─► live_start_push / live_stop_push  ──►  media-infra (RTMP → HLS)
```

* `lib/mqtt.ts` subscribes to `sys/product/+/status`, `thing/product/+/osd`,
  `thing/product/+/state`, `thing/product/+/services_reply`,
  `thing/product/+/events` and feeds an in-memory `DeviceRegistry`.
* `routes/device.ts` exposes `GET /api/device`, `GET /api/device/:sn`, and
  `GET /api/sse/device` (Server-Sent Events) for the web UI.
* `routes/livestream.ts` exposes `POST/DELETE /api/device/:sn/livestream`,
  which invokes the DJI `live_start_push` / `live_stop_push` Thing-Model
  services over MQTT.
* `lib/dji-cloud.ts` exposes the DJI Pilot-facing `/manage/api/v1/*` surface:
  `iam/login`, `workspaces/:id/devices`, `devices/:sn/binding`,
  `livestream/capacity`.
* The web UI (`web/`) lists devices, displays live OSD telemetry, and
  plays HLS published by an external media relay (e.g. mediamtx).

## Environment

| Variable          | Purpose                                                       | Default                    |
|-------------------|---------------------------------------------------------------|----------------------------|
| `API_URL`         | CloudTAK API base URL (login is federated here)               | `http://localhost:5001`    |
| `StackName`       | Deployment marker; `test` enables dev defaults                | `test`                     |
| `SigningSecret`   | HS256 secret used to sign JWTs minted by this service         | random per-process in prod |
| `MQTT_URL`        | Broker URL this service connects to                           | `mqtt://localhost:1883`    |
| `MQTT_PUBLIC_URL` | URL handed back to DJI Pilot (often the same as `MQTT_URL`)   | `MQTT_URL`                 |
| `MQTT_USERNAME`   | Optional broker creds                                         | —                          |
| `MQTT_PASSWORD`   | Optional broker creds                                         | —                          |
| `WORKSPACE_ID`    | Workspace handed back in IAM responses                        | `default-workspace`        |
| `DJI_APP_ID`      | DJI Pilot Cloud-API `app_id` (integer issued by DJI)          | —                          |
| `DJI_APP_KEY`     | DJI Pilot Cloud-API `app_key`                                 | —                          |
| `DJI_APP_LICENSE` | DJI Pilot Cloud-API license string                            | —                          |
| `RTMP_HOST`       | Host included in the default `live_start_push` URL            | `media-infra`              |

## Develop

```sh
npm install
cd web && npm install && cd ..

# Backend (port 5004)
npm run dev

# Web (port 8080)
cd web && npm run serve
```

You will need:

* A reachable CloudTAK API (`API_URL`) — login is forwarded there.
* An MQTT broker (`MQTT_URL`) — the bundled `docker-compose.yml` runs
  Mosquitto for local development.
* For live video: an RTMP-in / HLS-out relay reachable at
  `${origin}/live/{sn}/index.m3u8` (mediamtx, nginx-rtmp, etc.).

## Pilot configuration

In DJI Pilot 2 → "Cloud Services" → add a new server pointing at this
service. Pilot will hit `POST /manage/api/v1/iam/login` with username +
password; we federate those credentials to CloudTAK and hand the broker
coordinates back so the aircraft begins publishing OSD frames.

[dji-cloud]: https://developer.dji.com/doc/cloud-api-tutorial/en/
