# Video Agent UI

PC 조립 데모 촬영 현장의 노트북/모니터에 표시하는 로컬 운용 화면입니다. 기본 개발 모드에서는 브라우저에 연결된 웹캠을 직접 사용하며, 운영 모드에서는 저장소에 포함된 RealSense 캡처 백엔드의 Color MJPEG 스트림을 프록시합니다. 카메라 영상은 이 UI에서 저장하지 않습니다.

## 빠른 시작

필수 환경:

- macOS 또는 Linux
- Node.js `22.13.0` 이상
- npm `10` 이상

`nvm`을 사용하는 경우 저장소 루트에서 지정 버전을 바로 적용할 수 있습니다.

```bash
nvm install
nvm use
cd site
npm ci
npm run dev
```

터미널에 표시되는 `http://localhost:3000`을 엽니다. 첫 실행 시 브라우저가 카메라 권한을 요청할 수 있습니다. 카메라 없이도 UI와 장면 전환은 확인할 수 있습니다.

> Node.js 20에서는 현재 빌드 도구가 실행되지 않습니다. 반드시 Node.js 22.13.0 이상을 사용하세요.

## 실행 모드

### 로컬 개발 및 웹캠 모드

기본 개발 서버 포트 `3000`에서는 브라우저의 `MediaDevices` API를 사용합니다.

1. `http://localhost:3000`을 엽니다.
2. 우측 상단 `입력 설정`으로 촬영 제어를 엽니다.
3. `카메라 3대 연결`을 누르고 브라우저 카메라 권한을 허용합니다.
4. 자동 배정이 맞지 않으면 각 슬롯의 카메라를 직접 선택합니다.

카메라가 없어도 단계 이동, 레이아웃, 전체화면 오버레이 등 UI 기능은 동작합니다.

### RealSense 운영 모드

포트 `8080`으로 실행하면 앱이 RealSense 운영 모드로 전환됩니다. 이 모드에서는 `backend/server.py` 캡처 백엔드를 함께 실행해야 합니다.

기본 백엔드 주소:

- 상태 API: `http://127.0.0.1:8765/api/status`
- Color MJPEG: `http://127.0.0.1:8765/stream/{0..2}.mjpg`
- 카메라 설정: `PUT http://127.0.0.1:8765/api/cameras/{0..2}/config`

백엔드 주소가 다르면 `site/.env.local`을 만들고 다음 값을 지정합니다.

```dotenv
REALSENSE_STATUS_URL=http://127.0.0.1:8765/api/status
REALSENSE_STREAM_BASE_URL=http://127.0.0.1:8765
```

RealSense 호스트에는 다음 Python 패키지와 장치 접근 권한이 필요합니다.

- `pyrealsense2`
- `opencv-python` 또는 배포판의 `python3-opencv`
- `numpy`
- 실행 사용자의 `video` 그룹 권한

백엔드 수동 실행 예시:

```bash
python3 backend/server.py \
  --bind 127.0.0.1 --port 8765 \
  --width 424 --height 240 --fps 10 \
  --profile-state ~/.config/video-agent-ui/camera-profiles.json \
  --serials <CAM01_SERIAL>,<CAM02_SERIAL>,<CAM03_SERIAL>
```

프런트엔드 운영 모드 실행:

```bash
cd site
npm ci
npm run build
npm run start -- -p 8080 -H 0.0.0.0
```

같은 LAN의 다른 기기에서는 `http://<실행-PC-IP>:8080`으로 접속합니다. 실제 배포에 사용한 user systemd 예시는 `deployment/`에 있습니다.

`Scene Control`의 `RealSense Input`에서 카메라별로 `424×240`, `640×360`, `640×480` 해상도와 `5Hz`, `10Hz`, `15Hz` 전송률을 선택하고 `Apply`를 누를 수 있습니다. 적용 시 해당 카메라만 잠시 재연결되며 선택값은 `--profile-state` JSON 파일에 저장되어 서비스 재시작 후에도 유지됩니다. 공유 USB 컨트롤러 부하를 고려해 더 높은 해상도와 전송률은 UI에서 제공하지 않습니다.

### 접속 화면 간 상태 공유

같은 서버 주소로 접속한 화면들은 하나의 운영 세션을 공유합니다. 한 화면에서 장면 단계나 주 화면 카메라를 바꾸거나 작업 지시문을 제출하면 다른 화면에도 약 0.4초 이내에 반영됩니다. `Edit instruction` 편집 여부, 제출된 지시문, 계획 생성 진행 상태, `Confirm` 이후의 관찰 화면 전환도 모든 접속 화면에서 동일하게 유지됩니다. 입력 중인 초안은 타이핑과 커서가 방해받지 않도록 해당 화면에만 유지됩니다.

공유 항목:

- 현재 장면 단계와 단계에 따른 주 화면 카메라
- 사용자가 직접 선택한 주 화면 카메라
- 제출된 작업 지시 텍스트와 계획 생성 진행 상태
- 카메라별 해상도와 전송률(RealSense 백엔드 상태)

각 접속 화면에서 독립적으로 유지되는 항목:

- `Scene Control` 열림/닫힘
- 카메라 `Expand` 화면
- 입력 중인 작업 지시 초안, 키보드 포커스와 텍스트 커서 위치

## 촬영 조작

- `Esc`: Scene Control 또는 카메라 확대 화면 닫기
- `←` / `→`: 이전/다음 시나리오 상태
- `1` / `2` / `3`: 해당 카메라를 주 화면으로 전환
- 하단 장면 타임라인: 시나리오 상태 직접 이동
- 카메라별 `Expand`: 해당 영상을 웹페이지 안에서 확대

## 개발 확인

```bash
cd site
npm run lint
npm run build
```

빌드 결과물과 로컬 캐시는 Git에서 제외됩니다. 애플리케이션 환경 변수는 커밋하지 말고 `site/.env.local`에 둡니다.

## 프로젝트 구조

- `site/app/page.tsx`: 화면과 카메라 모드/조작
- `site/app/globals.css`: 전체 UI 스타일
- `site/app/api/cameras/route.ts`: RealSense 상태 프록시
- `site/app/api/cameras/[slot]/config/route.ts`: 카메라별 해상도/전송률 설정 프록시
- `site/app/api/session-state/route.ts`: 접속 화면 간 공유 운영 상태 API
- `site/lib/session-state.ts`: 공유 상태 타입, 기본값 및 입력 검증
- `site/app/camera-stream/[slot]/route.ts`: Color MJPEG 프록시
- `backend/server.py`: RealSense 검색, Color 캡처, 프로필 적용 및 상태 API
- `deployment/`: LAN 배포용 user systemd 예시
- `SCENARIO_AND_SCREEN_DRAFT.md`: 시나리오 사실과 화면 초안의 경계
- `DESIGN.md`: 시각 방향과 결정 근거
- `THIRD_PARTY_NOTICES.md`: 포함된 외부 자료와 라이선스

UI를 수정할 때는 현재 사용자 요구와 `SCENARIO_AND_SCREEN_DRAFT.md`를 먼저 지키고, `DESIGN.md`의 방향에 `antislop.md`를 필터로 적용합니다.
