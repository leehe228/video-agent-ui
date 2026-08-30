'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Tone = 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'violet';
type CameraStatus = 'idle' | 'connecting' | 'live' | 'error';

type RemoteCameraInfo = {
  slot: number;
  status: string;
  error?: string;
  width?: number;
  height?: number;
  target_fps?: number;
  fps?: number;
  depth?: {
    status?: string;
    width?: number;
    height?: number;
    target_fps?: number;
    fps?: number;
  };
};

type StageState = {
  id: string;
  scene: string;
  phase: number;
  protocol: 'READY' | 'PLANNING' | 'RUNNING' | 'CHECK';
  status: string;
  headline: string;
  detail: string;
  actor: string;
  tone: Tone;
  focusCamera: number;
};

const PHASES = ['작업서', '계획', '조립', '협업', '시연·재시도', '완료'];

const STAGE_STATES: StageState[] = [
  { id: 'standby', scene: 'S00', phase: 0, protocol: 'READY', status: '대기', headline: '작업대 관찰 준비', detail: '작업서 → 에이전트 → 로봇·사람', actor: '사람 · 로봇', tone: 'blue', focusCamera: 1 },
  { id: 'instruction', scene: 'S01', phase: 0, protocol: 'READY', status: '작업서 입력 완료', headline: 'PC 조립 작업 기준을 입력했습니다', detail: '작업 단계 · 부품 · 완료 조건 확인', actor: '사람', tone: 'blue', focusCamera: 0 },
  { id: 'planning', scene: 'S02', phase: 1, protocol: 'PLANNING', status: '작업 계획', headline: '작업 순서·역할을 계획합니다', detail: '로봇: GPU·공구·전원  /  사람: SSD·나사 체결', actor: '에이전트', tone: 'blue', focusCamera: 1 },
  { id: 'plan-ready', scene: 'S02 · READY', phase: 1, protocol: 'READY', status: '첫 작업 준비', headline: '계획 완료: 첫 작업을 활성화합니다', detail: '로봇 · GPU 장착', actor: '에이전트', tone: 'blue', focusCamera: 1 },
  { id: 'observing', scene: 'S03', phase: 1, protocol: 'RUNNING', status: '작업대 인식', headline: '부품·사람·작업 영역을 확인합니다', detail: 'GPU · SSD · 드라이버 · 사람 · 장착 위치', actor: '에이전트', tone: 'cyan', focusCamera: 1 },
  { id: 'gpu', scene: 'S04', phase: 2, protocol: 'RUNNING', status: 'GPU 장착', headline: 'GPU를 정렬하고 삽입합니다', detail: '슬롯 걸쇠 · 브래킷 정렬', actor: '로봇', tone: 'green', focusCamera: 2 },
  { id: 'gpu-check', scene: 'S04 · CHECK', phase: 2, protocol: 'CHECK', status: 'GPU 장착 확인', headline: 'GPU 장착 상태를 확인합니다', detail: '슬롯 걸쇠 · 브래킷 정렬', actor: '에이전트', tone: 'cyan', focusCamera: 2 },
  { id: 'ssd', scene: 'S05', phase: 2, protocol: 'RUNNING', status: 'SSD 장착', headline: '사람이 SSD를 장착합니다', detail: '에이전트가 로봇 카메라로 완료 상태를 확인합니다', actor: '사람', tone: 'green', focusCamera: 2 },
  { id: 'ssd-check', scene: 'S05 · CHECK', phase: 2, protocol: 'CHECK', status: 'SSD 위치 확인', headline: 'SSD 고정 위치를 확인합니다', detail: 'M.2 슬롯 · 나사 체결 위치', actor: '에이전트', tone: 'cyan', focusCamera: 2 },
  { id: 'safety-hold', scene: 'S06', phase: 3, protocol: 'CHECK', status: '안전 정지', headline: '사람 접근 감지: 접촉 전에 정지합니다', detail: '안전 상태가 확인될 때까지 드라이버 전달을 중단합니다', actor: '로봇', tone: 'red', focusCamera: 1 },
  { id: 'handover', scene: 'S06 · HANDOVER', phase: 3, protocol: 'RUNNING', status: '공구 전달', headline: '드라이버를 안전하게 전달합니다', detail: '사람이 손잡이를 잡은 뒤 로봇이 놓습니다', actor: '로봇', tone: 'green', focusCamera: 0 },
  { id: 'fastening', scene: 'S06 · FASTENING', phase: 3, protocol: 'RUNNING', status: '나사 체결', headline: '사람이 SSD 나사를 체결합니다', detail: '체결 후 드라이버를 지정 위치에 내려놓습니다', actor: '사람', tone: 'green', focusCamera: 2 },
  { id: 'failed', scene: 'S07', phase: 4, protocol: 'CHECK', status: '연결 실패', headline: '파워 케이블이 완전히 체결되지 않았습니다', detail: '더 밀지 않고 안전 위치로 물러납니다', actor: '에이전트', tone: 'amber', focusCamera: 2 },
  { id: 'demo', scene: 'S08', phase: 4, protocol: 'RUNNING', status: '시연 관찰', headline: '사람의 방향 시연을 관찰합니다', detail: '사람은 연결하지 않고 방향과 접근 방식만 보여줍니다', actor: '로봇', tone: 'violet', focusCamera: 2 },
  { id: 'retry', scene: 'S09', phase: 4, protocol: 'RUNNING', status: '파워 케이블 재시도', headline: '시연과 같은 방향으로 다시 시도합니다', detail: '사람의 시연 → 로봇 재시도', actor: '로봇', tone: 'violet', focusCamera: 2 },
  { id: 'verified', scene: 'S09 · CHECK', phase: 4, protocol: 'CHECK', status: '파워 케이블 연결 완료', headline: '파워 케이블 연결을 확인했습니다', detail: '완전 체결 상태를 확인했습니다', actor: '에이전트', tone: 'green', focusCamera: 2 },
  { id: 'power-on', scene: 'S10 · POWER', phase: 5, protocol: 'RUNNING', status: 'PC 전원 켜기', headline: '로봇이 PC 전원 버튼을 누릅니다', detail: 'PC 팬과 조명이 켜지고 부팅 화면이 나타납니다', actor: '로봇', tone: 'green', focusCamera: 1 },
  { id: 'complete', scene: 'S10 · CHECK', phase: 5, protocol: 'CHECK', status: '조립 완료', headline: 'PC 부팅과 조립 결과를 확인했습니다', detail: 'PC 정상 부팅 확인', actor: '에이전트', tone: 'green', focusCamera: 1 },
];

const CAMERA_NAMES = ['관찰 시점', '작업대 전체', '조립부 상세'];
const CAMERA_SHORTCUTS = ['1', '2', '3'];

function cameraStatusLabel(status: CameraStatus) {
  if (status === 'live') return '실시간';
  if (status === 'connecting') return '연결 중';
  if (status === 'error') return '오프라인';
  return '미연결';
}

function cameraPlaceholderLabel(status: CameraStatus) {
  if (status === 'connecting') return '카메라 연결 중';
  if (status === 'error') return '카메라 오프라인';
  return '카메라 미연결';
}

export default function Home() {
  const [stageIndex, setStageIndex] = useState(0);
  const [featuredCamera, setFeaturedCamera] = useState(1);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState(['', '', '']);
  const [cameraStatuses, setCameraStatuses] = useState<CameraStatus[]>(['idle', 'idle', 'idle']);
  const [cameraErrors, setCameraErrors] = useState(['', '', '']);
  const [isConnectingAll, setIsConnectingAll] = useState(false);
  const [globalCameraMessage, setGlobalCameraMessage] = useState('카메라 3대를 연결하려면 촬영 제어를 여세요');
  const [remoteCameraMode, setRemoteCameraMode] = useState(false);
  const [remoteCameras, setRemoteCameras] = useState<RemoteCameraInfo[]>([]);
  const [expandedCamera, setExpandedCamera] = useState<number | null>(null);

  const videoRefs = useRef<Array<HTMLVideoElement | null>>([null, null, null]);
  const streamsRef = useRef<Array<MediaStream | null>>([null, null, null]);
  const requestVersionsRef = useRef([0, 0, 0]);
  const selectedDeviceIdsRef = useRef(selectedDeviceIds);
  const stageRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const expandedCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const expandedVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentState = STAGE_STATES[stageIndex];
  const liveCount = useMemo(() => cameraStatuses.filter((status) => status === 'live').length, [cameraStatuses]);
  const cameraSummary = useMemo(() => {
    if (isConnectingAll || cameraStatuses.some((status) => status === 'connecting')) return '카메라 연결 중…';
    if (liveCount === 3) return remoteCameraMode ? 'RealSense 3대 연결 완료 · 10Hz' : '카메라 3대 연결 완료';
    if (liveCount > 0) return `카메라 ${liveCount} / 3대 연결됨`;
    if (cameraStatuses.some((status) => status === 'error')) return '카메라 0 / 3대 연결됨 · 연결을 확인해 주세요';
    return globalCameraMessage;
  }, [cameraStatuses, globalCameraMessage, isConnectingAll, liveCount, remoteCameraMode]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const mediaDevices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = mediaDevices.filter((device) => device.kind === 'videoinput');
    setDevices(videoDevices);
    return videoDevices;
  }, []);

  const releaseCameraStream = useCallback((slot: number) => {
    streamsRef.current[slot]?.getTracks().forEach((track) => track.stop());
    streamsRef.current[slot] = null;
    if (videoRefs.current[slot]) videoRefs.current[slot]!.srcObject = null;
  }, []);

  const stopCamera = useCallback((slot: number) => {
    requestVersionsRef.current[slot] += 1;
    releaseCameraStream(slot);
  }, [releaseCameraStream]);

  const openCamera = useCallback(async (slot: number, deviceId: string) => {
    if (!navigator.mediaDevices?.getUserMedia || !deviceId) return false;
    const requestVersion = requestVersionsRef.current[slot] + 1;
    requestVersionsRef.current[slot] = requestVersion;
    releaseCameraStream(slot);
    setCameraStatuses((previous) => previous.map((status, index) => index === slot ? 'connecting' : status));
    setCameraErrors((previous) => previous.map((message, index) => index === slot ? '' : message));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 24 } },
      });

      if (requestVersionsRef.current[slot] !== requestVersion) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      streamsRef.current[slot] = stream;
      const video = videoRefs.current[slot];
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }

      if (requestVersionsRef.current[slot] !== requestVersion) {
        stream.getTracks().forEach((track) => track.stop());
        if (video?.srcObject === stream) video.srcObject = null;
        return false;
      }

      const [track] = stream.getVideoTracks();
      track?.addEventListener('ended', () => {
        if (requestVersionsRef.current[slot] !== requestVersion) return;
        streamsRef.current[slot] = null;
        setCameraStatuses((previous) => previous.map((status, index) => index === slot ? 'error' : status));
        setCameraErrors((previous) => previous.map((message, index) => index === slot ? '카메라 연결이 끊어졌습니다' : message));
      });
      setCameraStatuses((previous) => previous.map((status, index) => index === slot ? 'live' : status));
      return true;
    } catch (error) {
      if (requestVersionsRef.current[slot] !== requestVersion) return false;
      const message = error instanceof DOMException && error.name === 'NotAllowedError' ? '카메라 권한이 필요합니다' : '카메라를 열 수 없습니다';
      setCameraStatuses((previous) => previous.map((status, index) => index === slot ? 'error' : status));
      setCameraErrors((previous) => previous.map((current, index) => index === slot ? message : current));
      return false;
    }
  }, [releaseCameraStream]);

  const connectAllCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setGlobalCameraMessage('이 브라우저에서는 카메라를 사용할 수 없습니다');
      return;
    }
    if (isConnectingAll) return;
    setIsConnectingAll(true);
    setGlobalCameraMessage('카메라 권한을 확인하고 있습니다');
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      const availableDevices = await refreshDevices();
      const nextIds = [0, 1, 2].map((slot) => availableDevices[slot]?.deviceId ?? '');
      selectedDeviceIdsRef.current = nextIds;
      setSelectedDeviceIds(nextIds);
      if (!availableDevices.length) {
        setGlobalCameraMessage('연결된 카메라를 찾지 못했습니다');
        return;
      }
      const results = await Promise.all(nextIds.map((deviceId, slot) => deviceId ? openCamera(slot, deviceId) : Promise.resolve(false)));
      const successCount = results.filter(Boolean).length;
      if (successCount === 0) setGlobalCameraMessage('카메라를 연결하지 못했습니다');
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      setGlobalCameraMessage(denied ? '브라우저에서 카메라 권한을 허용해 주세요' : '카메라 연결을 확인해 주세요');
    } finally {
      setIsConnectingAll(false);
    }
  }, [isConnectingAll, openCamera, refreshDevices]);

  const changeCameraDevice = useCallback(async (slot: number, deviceId: string) => {
    const nextIds = selectedDeviceIds.map((current, index) => index === slot ? deviceId : current);
    selectedDeviceIdsRef.current = nextIds;
    setSelectedDeviceIds(nextIds);
    if (!deviceId) {
      stopCamera(slot);
      setCameraStatuses((previous) => previous.map((status, index) => index === slot ? 'idle' : status));
      setCameraErrors((previous) => previous.map((message, index) => index === slot ? '' : message));
      if (nextIds.every((selectedId) => !selectedId)) setGlobalCameraMessage('카메라 3대를 연결하려면 촬영 제어를 여세요');
      return;
    }
    await openCamera(slot, deviceId);
  }, [openCamera, selectedDeviceIds, stopCamera]);

  const selectStage = useCallback((index: number) => {
    const boundedIndex = Math.min(STAGE_STATES.length - 1, Math.max(0, index));
    setStageIndex(boundedIndex);
    setFeaturedCamera(STAGE_STATES[boundedIndex].focusCamera);
  }, []);

  const moveStage = useCallback((direction: number) => {
    selectStage(stageIndex + direction);
  }, [selectStage, stageIndex]);

  useEffect(() => {
    const modeTimer = window.setTimeout(() => setRemoteCameraMode(window.location.port === '8080'), 0);
    return () => window.clearTimeout(modeTimer);
  }, []);

  useEffect(() => {
    if (!remoteCameraMode) return;
    let cancelled = false;

    const refreshRemoteCameras = async () => {
      try {
        const response = await fetch('/api/cameras', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { cameras?: RemoteCameraInfo[] };
        if (cancelled) return;
        const cameras = Array.isArray(payload.cameras) ? payload.cameras : [];
        setRemoteCameras(cameras);
        setCameraStatuses([0, 1, 2].map((slot) => {
          const status = cameras.find((camera) => camera.slot === slot)?.status;
          if (status === 'live') return 'live';
          if (status === 'offline' || status === 'stale') return 'error';
          return 'connecting';
        }));
        setCameraErrors([0, 1, 2].map((slot) => cameras.find((camera) => camera.slot === slot)?.error ?? ''));
        setGlobalCameraMessage('RealSense 캡처 서버 연결됨 · 10Hz');
      } catch {
        if (cancelled) return;
        setRemoteCameras([]);
        setCameraStatuses(['error', 'error', 'error']);
        setCameraErrors(['RealSense 서버 응답 없음', 'RealSense 서버 응답 없음', 'RealSense 서버 응답 없음']);
        setGlobalCameraMessage('RealSense 캡처 서버에 연결할 수 없습니다');
      }
    };

    void refreshRemoteCameras();
    const refreshTimer = window.setInterval(() => void refreshRemoteCameras(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [remoteCameraMode]);

  useEffect(() => {
    if (remoteCameraMode) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const initialRefresh = window.setTimeout(() => refreshDevices().catch(() => undefined), 0);
    const handleDeviceChange = async () => {
      const availableDevices = await refreshDevices();
      const availableIds = new Set(availableDevices.map((device) => device.deviceId));
      await Promise.all(selectedDeviceIdsRef.current.map(async (deviceId, slot) => {
        if (!deviceId) return;
        if (!availableIds.has(deviceId)) {
          stopCamera(slot);
          setCameraStatuses((previous) => previous.map((status, index) => index === slot ? 'error' : status));
          setCameraErrors((previous) => previous.map((message, index) => index === slot ? '카메라 연결이 끊어졌습니다' : message));
          return;
        }
        const streamIsLive = streamsRef.current[slot]?.getVideoTracks().some((track) => track.readyState === 'live');
        if (!streamIsLive) await openCamera(slot, deviceId);
      }));
    };
    mediaDevices.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      window.clearTimeout(initialRefresh);
      mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, [openCamera, refreshDevices, remoteCameraMode, stopCamera]);

  useEffect(() => {
    if (controlsOpen) {
      window.setTimeout(() => closeButtonRef.current?.focus(), 260);
    } else {
      stageRef.current?.focus();
    }
  }, [controlsOpen]);

  useEffect(() => {
    if (expandedCamera === null) return;
    expandedCloseButtonRef.current?.focus();
    const expandedVideo = expandedVideoRef.current;
    if (expandedVideo && streamsRef.current[expandedCamera]) {
      expandedVideo.srcObject = streamsRef.current[expandedCamera];
      void expandedVideo.play().catch(() => undefined);
    }
  }, [expandedCamera]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'escape' || key === 'esc') {
        if (expandedCamera !== null) {
          setExpandedCamera(null);
          return;
        }
        setControlsOpen(false);
        return;
      }
      if (expandedCamera !== null) return;
      if (key === 'c') {
        setControlsOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches('select, button, input')) return;
      if (key === 'arrowright' || key === 'right') {
        event.preventDefault();
        moveStage(1);
      }
      if (key === 'arrowleft' || key === 'left') {
        event.preventDefault();
        moveStage(-1);
      }
      const cameraIndex = CAMERA_SHORTCUTS.indexOf(event.key);
      if (cameraIndex >= 0) setFeaturedCamera(cameraIndex);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedCamera, moveStage]);

  useEffect(() => () => {
    streamsRef.current.forEach((stream) => stream?.getTracks().forEach((track) => track.stop()));
  }, []);

  return (
    <main ref={stageRef} className="app-shell" data-tone={currentState.tone} tabIndex={-1}>
      <header className="app-header">
        <div className="brand-lockup">
          <span>Workcell Console</span>
        </div>
        <div className="workspace-title">
          <strong>PC 조립 에이전트</strong>
          <span>촬영용 로컬 세션</span>
        </div>
        <div className="header-actions">
          <span className="camera-health" role="status" aria-live="polite"><i aria-hidden="true" /> 카메라 {liveCount} / 3{remoteCameraMode ? ' · 10Hz' : ''}</span>
          <button className="settings-button" type="button" onClick={() => setControlsOpen(true)}>입력 설정</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sequence-panel" aria-label="작업 진행 단계">
          <div className="sequence-heading">
            <span>{currentState.protocol}</span>
            <h2>작업 순서</h2>
            <p>{currentState.scene} · {currentState.status}</p>
          </div>
          <div className="phase-list">
            {PHASES.map((phase, index) => (
              <div className={index === currentState.phase ? 'active' : index < currentState.phase ? 'done' : ''} key={phase}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{phase}</strong>
                <i aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="run-details">
            <div><span>현재 담당</span><strong>{currentState.actor}</strong></div>
            <div><span>주 화면</span><strong>CAM 0{featuredCamera + 1}</strong></div>
          </div>
          <p className="sequence-note">장면은 아래 타임라인이나 방향키로 이동합니다.</p>
        </aside>

        <section className="camera-workspace" aria-label="카메라 작업공간">
          <div className="panel-heading">
            <div><h2>실시간 작업공간</h2><p>카메라를 선택하면 주 화면으로 확대됩니다.</p></div>
            <span>{CAMERA_NAMES[featuredCamera]}</span>
          </div>

          <section className="camera-grid" aria-label="실시간 카메라 3개">
            {[0, 1, 2].map((slot) => {
              const isFeatured = slot === featuredCamera;
              const secondaryIndex = [0, 1, 2].filter((index) => index !== featuredCamera).indexOf(slot);
              const status = cameraStatuses[slot];
              const depthLive = remoteCameras.find((camera) => camera.slot === slot)?.depth?.status === 'live';
              return (
                <article
                  className={`camera-card ${isFeatured ? 'featured' : `secondary secondary-${secondaryIndex + 1}`}`}
                  data-camera-status={status}
                  data-remote={remoteCameraMode ? 'true' : 'false'}
                  key={slot}
                  aria-label={`CAM 0${slot + 1} ${CAMERA_NAMES[slot]}`}
                >
                  <div className="camera-topline">
                    <div><span className="camera-number">CAM 0{slot + 1}</span><strong>{CAMERA_NAMES[slot]}</strong></div>
                    <span className="live-label"><i aria-hidden="true" /> {cameraStatusLabel(status)}</span>
                  </div>
                  <div className="camera-viewport">
                    {remoteCameraMode ? (
                      // MJPEG is a continuous multipart response and must use a native img element.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="remote-stream"
                        src={`/camera-stream/${slot}`}
                        alt={`${CAMERA_NAMES[slot]} RealSense 실시간 영상`}
                        decoding="async"
                        onLoad={() => setCameraStatuses((previous) => previous.map((current, index) => index === slot ? 'live' : current))}
                        onError={() => setCameraStatuses((previous) => previous.map((current, index) => index === slot ? 'error' : current))}
                      />
                    ) : (
                      <video aria-label={`${CAMERA_NAMES[slot]} 실시간 영상`} autoPlay muted playsInline ref={(element) => {
                        videoRefs.current[slot] = element;
                        if (element && streamsRef.current[slot]) element.srcObject = streamsRef.current[slot];
                      }} />
                    )}
                    {remoteCameraMode && depthLive && (
                      <div className="depth-pip" aria-label={`${CAMERA_NAMES[slot]} Depth 영상`}>
                        <span>DEPTH</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/depth-stream/${slot}`} alt="" aria-hidden="true" />
                      </div>
                    )}
                    <div className="camera-placeholder" aria-hidden={status === 'live'}>
                      <div className="camera-placeholder-copy"><strong>{cameraPlaceholderLabel(status)}</strong><span>{cameraErrors[slot] || (remoteCameraMode ? 'RealSense 스트림을 확인하고 있습니다' : '입력 설정에서 카메라를 연결하세요')}</span></div>
                    </div>
                  </div>
                  <div className="camera-actions">
                    <button type="button" onClick={() => setFeaturedCamera(slot)} disabled={isFeatured}>주 화면</button>
                    <button className="expand-camera-button" type="button" onClick={() => setExpandedCamera(slot)} disabled={status !== 'live'}>전체화면</button>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="operation-panel" aria-label="에이전트 현재 판단">
            <div className="operation-copy"><span>현재 작업</span><h1>{currentState.headline}</h1><p>{currentState.detail}</p></div>
            <div className="stage-transport">
              <button type="button" onClick={() => moveStage(-1)} disabled={stageIndex === 0} aria-label="이전 장면">이전</button>
              <div className="timeline-control">
                <div><span>{currentState.scene}</span><strong>{currentState.status}</strong></div>
                <input type="range" min="0" max={STAGE_STATES.length - 1} value={stageIndex} onInput={(event) => selectStage(Number(event.currentTarget.value))} onChange={(event) => selectStage(Number(event.currentTarget.value))} aria-label="장면 타임라인" />
              </div>
              <button type="button" onClick={() => moveStage(1)} disabled={stageIndex === STAGE_STATES.length - 1} aria-label="다음 장면">다음</button>
            </div>
          </section>
        </section>
      </div>

      {expandedCamera !== null && (
        <section className="camera-overlay" role="dialog" aria-modal="true" aria-label={`CAM 0${expandedCamera + 1} 전체화면`} onClick={() => setExpandedCamera(null)}>
          <div className="camera-overlay-header" onClick={(event) => event.stopPropagation()}>
            <div><span>CAM 0{expandedCamera + 1}</span><strong>{CAMERA_NAMES[expandedCamera]}</strong></div>
            <button ref={expandedCloseButtonRef} type="button" onClick={() => setExpandedCamera(null)} aria-label="전체화면 닫기">닫기</button>
          </div>
          <div className="camera-overlay-viewport" onClick={(event) => event.stopPropagation()}>
            {remoteCameraMode ? (
              // MJPEG is a continuous multipart response and must use a native img element.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="remote-stream" src={`/camera-stream/${expandedCamera}`} alt={`${CAMERA_NAMES[expandedCamera]} RealSense 전체화면 영상`} />
            ) : (
              <video ref={expandedVideoRef} aria-label={`${CAMERA_NAMES[expandedCamera]} 전체화면 영상`} autoPlay muted playsInline />
            )}
            {remoteCameraMode && remoteCameras.find((camera) => camera.slot === expandedCamera)?.depth?.status === 'live' && (
              <div className="depth-pip depth-pip-expanded" aria-label={`${CAMERA_NAMES[expandedCamera]} Depth 영상`}>
                <span>DEPTH</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/depth-stream/${expandedCamera}`} alt="" aria-hidden="true" />
              </div>
            )}
          </div>
        </section>
      )}

      <div className={`control-backdrop ${controlsOpen ? 'open' : ''}`} onClick={() => setControlsOpen(false)} />
      <aside className={`control-drawer ${controlsOpen ? 'open' : ''}`} aria-hidden={!controlsOpen} inert={!controlsOpen}>
        <div className="drawer-header">
          <div><h2>촬영 제어</h2></div>
          <button ref={closeButtonRef} type="button" onClick={() => setControlsOpen(false)} aria-label="촬영 제어 닫기">×</button>
        </div>
        <section className="control-section">
          <div className="control-section-heading"><h3>장면 상태</h3><span>← / →</span></div>
          <div className="stage-nav-buttons"><button type="button" onClick={() => moveStage(-1)} disabled={stageIndex === 0}>이전</button><button type="button" onClick={() => moveStage(1)} disabled={stageIndex === STAGE_STATES.length - 1}>다음</button></div>
          <div className="state-list">
            {STAGE_STATES.map((state, index) => (
              <button className={index === stageIndex ? 'active' : ''} type="button" key={state.id} onClick={() => selectStage(index)}><span>{state.scene}</span><strong>{state.status}</strong></button>
            ))}
          </div>
        </section>
        <section className="control-section camera-control-section">
          <div className="control-section-heading"><h3>{remoteCameraMode ? 'RealSense 입력' : '카메라 입력'}</h3><span>{liveCount} / 3 연결</span></div>
          {remoteCameraMode ? (
            <>
              <p className="camera-message">{cameraSummary}</p>
              <div className="remote-camera-list">
                {CAMERA_NAMES.map((name, slot) => {
                  const camera = remoteCameras.find((item) => item.slot === slot);
                  return <div key={name}><strong>CAM 0{slot + 1} · {name}</strong><span>{camera?.status === 'live' ? `${camera.width}×${camera.height} · ${camera.fps?.toFixed(1) ?? '0.0'}Hz` : camera?.error || '연결 확인 중'}</span></div>;
                })}
              </div>
            </>
          ) : (
            <>
              <button className="connect-button" type="button" onClick={connectAllCameras} disabled={isConnectingAll}>{isConnectingAll ? '카메라 연결 중…' : '카메라 3대 연결'}</button>
              <p className="camera-message">{cameraSummary}</p>
              <div className="device-selects">
                {CAMERA_NAMES.map((name, slot) => (
                  <label key={name}><span>CAM 0{slot + 1} · {name}</span>
                    <select value={selectedDeviceIds[slot]} onChange={(event) => changeCameraDevice(slot, event.target.value)} disabled={isConnectingAll}>
                      <option value="">카메라 선택</option>
                      {selectedDeviceIds[slot] && !devices.some((device) => device.deviceId === selectedDeviceIds[slot]) && (
                        <option value={selectedDeviceIds[slot]}>연결이 끊어진 카메라</option>
                      )}
                      {devices.map((device, deviceIndex) => {
                        const usedElsewhere = Boolean(device.deviceId) && selectedDeviceIds.some((selectedId, index) => index !== slot && selectedId === device.deviceId);
                        return <option key={device.deviceId || deviceIndex} value={device.deviceId} disabled={usedElsewhere}>{device.label || `Camera ${deviceIndex + 1}`}</option>;
                      })}
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="shortcut-guide"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 주 화면 전환</span><span><kbd>ESC</kbd> 제어 닫기</span></section>
      </aside>
    </main>
  );
}
