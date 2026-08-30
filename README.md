# Video Agent UI

PC 조립 데모 촬영 현장의 노트북/모니터에 표시하는 로컬 운용 화면입니다. 기본 개발 모드에서는 브라우저에 연결된 웹캠을 직접 사용하며, 운영 모드에서는 별도 RealSense 캡처 백엔드의 Color/Depth MJPEG 스트림을 프록시합니다. 카메라 영상은 이 UI에서 저장하지 않습니다.

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
2. 우측 상단 `입력 설정` 또는 `C` 키로 촬영 제어를 엽니다.
3. `카메라 3대 연결`을 누르고 브라우저 카메라 권한을 허용합니다.
4. 자동 배정이 맞지 않으면 각 슬롯의 카메라를 직접 선택합니다.

카메라가 없어도 단계 이동, 레이아웃, 전체화면 오버레이 등 UI 기능은 동작합니다.

### RealSense 운영 모드

포트 `8080`으로 실행하면 앱이 RealSense 운영 모드로 전환됩니다. 이 모드에는 이 저장소와 별도로 실행되는 캡처 백엔드가 필요합니다.

기본 백엔드 주소:

- 상태 API: `http://127.0.0.1:8765/api/status`
- Color MJPEG: `http://127.0.0.1:8765/stream/{0..2}.mjpg`
- Depth MJPEG: `http://127.0.0.1:8765/depth/{0..2}.mjpg`

백엔드 주소가 다르면 `site/.env.local`을 만들고 다음 값을 지정합니다.

```dotenv
REALSENSE_STATUS_URL=http://127.0.0.1:8765/api/status
REALSENSE_STREAM_BASE_URL=http://127.0.0.1:8765
```

운영 모드 실행:

```bash
cd site
npm ci
npm run build
npm run start -- -p 8080 -H 0.0.0.0
```

같은 LAN의 다른 기기에서는 `http://<실행-PC-IP>:8080`으로 접속합니다. 실제 배포에 사용한 user systemd 예시는 `deployment/`에 있습니다. `realsense-web-viewer.service`가 참조하는 `%h/realsense_web_viewer/server.py` 캡처 백엔드는 별도 구성 요소이며 이 저장소에는 포함되어 있지 않습니다.

## 촬영 조작

- `C`: 촬영 제어 열기/닫기
- `Esc`: 촬영 제어 또는 카메라 확대 화면 닫기
- `←` / `→`: 이전/다음 시나리오 상태
- `1` / `2` / `3`: 해당 카메라를 주 화면으로 전환
- 하단 장면 타임라인: 시나리오 상태 직접 이동
- 카메라별 `전체화면`: 해당 영상을 웹페이지 안에서 확대

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
- `site/app/camera-stream/[slot]/route.ts`: Color MJPEG 프록시
- `site/app/depth-stream/[slot]/route.ts`: Depth MJPEG 프록시
- `deployment/`: LAN 배포용 user systemd 예시
- `SCENARIO_AND_SCREEN_DRAFT.md`: 시나리오 사실과 화면 초안의 경계
- `DESIGN.md`: 시각 방향과 결정 근거
- `THIRD_PARTY_NOTICES.md`: 포함된 외부 자료와 라이선스

UI를 수정할 때는 현재 사용자 요구와 `SCENARIO_AND_SCREEN_DRAFT.md`를 먼저 지키고, `DESIGN.md`의 방향에 `antislop.md`를 필터로 적용합니다.
