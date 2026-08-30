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
  observation: string;
  response: string;
};

type PlanStep = {
  title: string;
  executor: string;
  detail: string;
};

type PlanningEvent = {
  label: string;
  detail: string;
};

type AgentTraceEvent = {
  id: string;
  kind: 'OBSERVE' | 'DECIDE' | 'ACT' | 'VERIFY';
  text: string;
};

type ReasoningTrace = {
  id: string;
  label: 'EVIDENCE' | 'CRITERIA' | 'ACTION';
  text: string;
};

const PLAN_STEPS: PlanStep[] = [
  { title: 'Install GPU', executor: 'ROBOT', detail: 'Align · insert · verify' },
  { title: 'Install RAM', executor: 'HUMAN', detail: 'Install two modules · verify' },
  { title: 'Handover & fasten', executor: 'ROBOT + HUMAN', detail: 'Safe handover · fastening' },
  { title: 'Mount mainboard', executor: 'HUMAN', detail: 'Position · secure in case' },
  { title: 'Connect power', executor: 'ROBOT', detail: 'Orient · insert · verify' },
  { title: 'Power-on check', executor: 'ROBOT + AGENT', detail: 'Power on · final verification' },
];

const RECOVERY_STATE_IDS = new Set(['failed', 'demo', 'retry']);

const PLANNING_EVENTS: PlanningEvent[] = [
  { label: 'Instruction received', detail: 'Local file registered for this session' },
  { label: 'Loading demo configuration', detail: 'Fixed mainboard assembly profile selected' },
  { label: 'Applying component set', detail: 'Configured GPU, RAM, driver, mainboard, and power cable loaded' },
  { label: 'Applying task constraints', detail: 'Configured order, handover, safety, and completion rules loaded' },
  { label: 'Assigning actors', detail: 'Demo configuration maps Robot, Human, and Agent roles' },
  { label: 'Building execution order', detail: 'Dependencies converted into six task steps' },
  { label: 'Attaching verification gates', detail: 'Visual checks linked to each physical action' },
  { label: 'Plan ready', detail: 'First executable task is ready to activate' },
];

function actorClass(actor: string) {
  if (actor.includes('ROBOT') && actor.includes('HUMAN')) return 'actor-shared';
  if (actor.includes('ROBOT') && actor.includes('AGENT')) return 'actor-shared';
  if (actor.includes('HUMAN')) return 'actor-human';
  if (actor.includes('ROBOT')) return 'actor-robot';
  return 'actor-agent';
}

const STAGE_STATES: StageState[] = [
  { id: 'standby', scene: 'S00', phase: -1, protocol: 'READY', status: 'Standby', headline: 'Waiting for a work instruction', detail: 'Monitoring cameras and the workcell', actor: 'HUMAN · ROBOT', tone: 'blue', focusCamera: 1, observation: 'No work instruction has been loaded', response: 'Keep the workcell in standby' },
  { id: 'instruction', scene: 'S01', phase: -1, protocol: 'READY', status: 'Instruction analysis', headline: 'Work instruction loaded', detail: 'Parsing parts, steps, and completion criteria', actor: 'AGENT', tone: 'blue', focusCamera: 0, observation: 'The work instruction and drawing are available', response: 'Extract goals and operating constraints' },
  { id: 'planning', scene: 'S02', phase: -1, protocol: 'PLANNING', status: 'Plan generation', headline: 'Planning the sequence and roles', detail: 'Robot: GPU, tool, power  /  Human: RAM, fastening', actor: 'AGENT', tone: 'blue', focusCamera: 1, observation: 'Required parts and actors are identified', response: 'Assign Robot and Human roles with verification steps' },
  { id: 'plan-ready', scene: 'S02 · READY', phase: 0, protocol: 'READY', status: 'Plan ready', headline: 'Ready to begin the first task', detail: 'First task · Install GPU', actor: 'AGENT', tone: 'blue', focusCamera: 1, observation: 'The plan and completion criteria are ready', response: 'Inspect the workcell before GPU installation' },
  { id: 'observing', scene: 'S03', phase: 0, protocol: 'RUNNING', status: 'Workcell inspection', headline: 'Inspecting parts and the work area', detail: 'GPU · RAM · driver · human · target slots', actor: 'AGENT', tone: 'cyan', focusCamera: 1, observation: 'Parts and human positions are being tracked', response: 'Confirm access to the GPU and target slot' },
  { id: 'gpu', scene: 'S04', phase: 0, protocol: 'RUNNING', status: 'GPU installation', headline: 'Aligning the GPU with the target slot', detail: 'Connector orientation · slot position · bracket alignment', actor: 'ROBOT', tone: 'green', focusCamera: 2, observation: 'The GPU and PCIe slot positions are confirmed', response: 'Maintain alignment and insert the GPU' },
  { id: 'gpu-check', scene: 'S04 · CHECK', phase: 0, protocol: 'CHECK', status: 'GPU verification', headline: 'Verifying GPU installation', detail: 'Slot latch · bracket · insertion depth', actor: 'AGENT', tone: 'cyan', focusCamera: 2, observation: 'The GPU is inserted into the target slot', response: 'Compare latch and bracket alignment with the criteria' },
  { id: 'ram', scene: 'S05', phase: 1, protocol: 'RUNNING', status: 'RAM installation', headline: 'Human is installing the RAM', detail: 'The agent monitors progress through the robot camera', actor: 'HUMAN', tone: 'green', focusCamera: 2, observation: 'The RAM is aligned with the target slot', response: 'Maintain clearance and monitor the installation' },
  { id: 'ram-check', scene: 'S05 · CHECK', phase: 1, protocol: 'CHECK', status: 'RAM verification', headline: 'Verifying RAM installation', detail: 'Slot latches · orientation · insertion depth', actor: 'AGENT', tone: 'cyan', focusCamera: 2, observation: 'Two RAM modules are installed', response: 'Verify the latches and insertion depth' },
  { id: 'safety-hold', scene: 'S06', phase: 2, protocol: 'CHECK', status: 'Human proximity detected', headline: 'Stopping before contact', detail: 'Waiting for the human hand to leave the work area', actor: 'ROBOT', tone: 'red', focusCamera: 1, observation: 'A human hand entered the robot work area', response: 'Pause the handover and enter safety hold' },
  { id: 'handover', scene: 'S06 · HANDOVER', phase: 2, protocol: 'RUNNING', status: 'Tool handover', headline: 'Handing over the driver safely', detail: 'Handle toward the human, bit facing away', actor: 'ROBOT', tone: 'green', focusCamera: 0, observation: 'The human hand has left the robot work area', response: 'Confirm clearance and resume the handover' },
  { id: 'fastening', scene: 'S06 · FASTENING', phase: 2, protocol: 'RUNNING', status: 'Fastening', headline: 'Human is fastening the screws', detail: 'The driver returns to the designated location afterward', actor: 'HUMAN', tone: 'green', focusCamera: 2, observation: 'The human has taken the driver', response: 'Maintain clearance and monitor fastening' },
  { id: 'case-install', scene: 'S07 · CASE', phase: 3, protocol: 'RUNNING', status: 'Case mounting', headline: 'Mounting the mainboard in the case', detail: 'Monitoring the human task and robot preparation in parallel', actor: 'HUMAN', tone: 'green', focusCamera: 1, observation: 'Mainboard component installation is complete', response: 'Mount the board while the robot prepares the power cable' },
  { id: 'failed', scene: 'S07', phase: 4, protocol: 'CHECK', status: 'Incomplete insertion detected', headline: 'The power cable is not fully seated', detail: 'Stopping insertion and retreating to a safe position', actor: 'ROBOT', tone: 'amber', focusCamera: 2, observation: 'Cable insertion does not meet the completion criteria', response: 'Avoid extra force, retreat, and wait for assistance' },
  { id: 'demo', scene: 'S08', phase: 4, protocol: 'RUNNING', status: 'Human demonstration detected', headline: 'Observing the demonstrated orientation', detail: 'The agent checks orientation and approach through the robot camera', actor: 'HUMAN', tone: 'violet', focusCamera: 2, observation: 'The human demonstrates the correct orientation and path', response: 'Extract orientation and approach from the demonstration' },
  { id: 'retry', scene: 'S09', phase: 4, protocol: 'RUNNING', status: 'Retry #1', headline: 'Retrying with the observed orientation', detail: 'Applying the approach learned from the demonstration', actor: 'ROBOT', tone: 'violet', focusCamera: 2, observation: 'The updated approach is now part of the plan', response: 'Realign the cable and retry the connection' },
  { id: 'verified', scene: 'S09 · CHECK', phase: 4, protocol: 'CHECK', status: 'Connection verified', headline: 'Power cable connection verified', detail: 'The seated position matches the completion criteria', actor: 'AGENT', tone: 'green', focusCamera: 2, observation: 'The cable is fully seated in the target port', response: 'Mark the power connection task complete' },
  { id: 'power-on', scene: 'S10 · POWER', phase: 5, protocol: 'RUNNING', status: 'Power on', headline: 'Robot is pressing the power button', detail: 'Checking fans, lights, and the boot display', actor: 'ROBOT', tone: 'green', focusCamera: 1, observation: 'All installation and connection tasks are complete', response: 'Apply power and monitor the startup state' },
  { id: 'complete', scene: 'S10 · CHECK', phase: 5, protocol: 'CHECK', status: 'Final check complete', headline: 'Startup and final result verified', detail: 'All planned tasks and completion criteria are satisfied', actor: 'AGENT', tone: 'green', focusCamera: 1, observation: 'Fans, lights, and the boot display are operating normally', response: 'Set the full task to complete' },
];

const CAMERA_NAMES = ['Observation view', 'Workcell wide', 'Assembly detail'];
const CAMERA_SHORTCUTS = ['1', '2', '3'];

function cameraStatusLabel(status: CameraStatus) {
  if (status === 'live') return 'Live';
  if (status === 'connecting') return 'Connecting';
  if (status === 'error') return 'Offline';
  return 'Not connected';
}

function cameraPlaceholderLabel(status: CameraStatus) {
  if (status === 'connecting') return 'Connecting camera';
  if (status === 'error') return 'Camera offline';
  return 'Camera not connected';
}

const CAMERA_MESSAGE_TRANSLATIONS: Record<string, string> = {
  '카메라 3대를 연결하려면 촬영 제어를 여세요': 'Open Scene Control to connect three cameras',
  '카메라 연결이 끊어졌습니다': 'Camera disconnected',
  '카메라 권한이 필요합니다': 'Camera permission required',
  '카메라를 열 수 없습니다': 'Unable to open camera',
  '이 브라우저에서는 카메라를 사용할 수 없습니다': 'Cameras are unavailable in this browser',
  '카메라 권한을 확인하고 있습니다': 'Checking camera permission',
  '연결된 카메라를 찾지 못했습니다': 'No connected cameras found',
  '카메라를 연결하지 못했습니다': 'Unable to connect cameras',
  '브라우저에서 카메라 권한을 허용해 주세요': 'Allow camera access in the browser',
  '카메라 연결을 확인해 주세요': 'Check the camera connection',
  'RealSense 캡처 서버 연결됨 · 10Hz': 'RealSense capture server connected · 10Hz',
  'RealSense 서버 응답 없음': 'RealSense server unavailable',
  'RealSense 캡처 서버에 연결할 수 없습니다': 'Unable to reach the RealSense capture server',
  '연결 확인 중': 'Checking connection',
};

function cameraMessageLabel(message: string) {
  return CAMERA_MESSAGE_TRANSLATIONS[message] ?? message;
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
  const [instructionFile, setInstructionFile] = useState<{ name: string; size: number; type: string } | null>(null);
  const [planningProgress, setPlanningProgress] = useState(-1);
  const [agentTrace, setAgentTrace] = useState<AgentTraceEvent[]>([]);
  const [reasoningTrace, setReasoningTrace] = useState<ReasoningTrace | null>(null);

  const videoRefs = useRef<Array<HTMLVideoElement | null>>([null, null, null]);
  const streamsRef = useRef<Array<MediaStream | null>>([null, null, null]);
  const requestVersionsRef = useRef([0, 0, 0]);
  const selectedDeviceIdsRef = useRef(selectedDeviceIds);
  const stageRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const expandedCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const expandedVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentState = STAGE_STATES[stageIndex];
  const isExecution = stageIndex >= 4;
  const planReady = planningProgress === PLANNING_EVENTS.length - 1;
  const generatedPlanCount = planningProgress < 2 ? 0 : Math.min(PLAN_STEPS.length, planningProgress - 1);
  const planStatus = isExecution ? 'PLAN ACTIVE' : planReady ? 'S02 READY' : planningProgress >= 0 ? 'PLANNING' : 'INSTRUCTION';
  const planningHeadline = planningProgress >= 0 ? PLANNING_EVENTS[Math.min(planningProgress, PLANNING_EVENTS.length - 1)].label : 'Awaiting work instruction';
  const liveCount = useMemo(() => cameraStatuses.filter((status) => status === 'live').length, [cameraStatuses]);
  const cameraSummary = useMemo(() => {
    if (isConnectingAll || cameraStatuses.some((status) => status === 'connecting')) return 'Connecting cameras…';
    if (liveCount === 3) return remoteCameraMode ? 'Three RealSense cameras connected · 10Hz' : 'Three cameras connected';
    if (liveCount > 0) return `${liveCount} / 3 cameras connected`;
    if (cameraStatuses.some((status) => status === 'error')) return '0 / 3 cameras connected · Check the connection';
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

  const loadInstruction = useCallback((file: File) => {
    setInstructionFile({ name: file.name, size: file.size, type: file.type || 'Local document' });
    setPlanningProgress(0);
    setAgentTrace([]);
    selectStage(1);
  }, [selectStage]);

  useEffect(() => {
    if (planningProgress < 0 || planningProgress >= PLANNING_EVENTS.length - 1) return;
    const planningTimer = window.setTimeout(() => {
      const nextProgress = Math.min(PLANNING_EVENTS.length - 1, planningProgress + 1);
      setPlanningProgress(nextProgress);
      if (nextProgress < 2) selectStage(1);
      else if (nextProgress < PLANNING_EVENTS.length - 1) selectStage(2);
      else selectStage(3);
    }, planningProgress === 0 ? 850 : 680);
    return () => window.clearTimeout(planningTimer);
  }, [planningProgress, selectStage]);

  useEffect(() => {
    if (!isExecution) return;
    const observationEvent: AgentTraceEvent = {
      id: `${stageIndex}-observe-${Date.now()}`,
      kind: 'OBSERVE',
      text: currentState.observation,
    };
    const reasoningId = `${stageIndex}-reasoning-${Date.now()}`;
    const evidenceTimer = window.setTimeout(() => {
      setReasoningTrace({ id: reasoningId, label: 'EVIDENCE', text: currentState.detail });
    }, 0);
    const criteriaTimer = window.setTimeout(() => {
      setReasoningTrace({
        id: reasoningId,
        label: 'CRITERIA',
        text: currentState.protocol === 'CHECK'
          ? `Matching the stage observation to ${currentState.status.toLowerCase()} criteria`
          : `Checking ${currentState.actor.toLowerCase()} readiness and workspace constraints`,
      });
    }, 520);
    const observationTimer = window.setTimeout(() => {
      setReasoningTrace(null);
      setAgentTrace((events) => [...events, observationEvent].slice(-8));
    }, 980);
    const responseKind: AgentTraceEvent['kind'] = currentState.protocol === 'CHECK' ? 'VERIFY' : currentState.actor === 'AGENT' ? 'DECIDE' : 'ACT';
    const actionReasoningTimer = window.setTimeout(() => {
      setReasoningTrace({
        id: `${reasoningId}-action`,
        label: 'ACTION',
        text: `Selecting the ${currentState.actor.toLowerCase()} response under the ${currentState.protocol.toLowerCase()} protocol`,
      });
    }, 1160);
    const responseTimer = window.setTimeout(() => {
      setReasoningTrace(null);
      setAgentTrace((events) => [...events, {
        id: `${stageIndex}-response-${Date.now()}`,
        kind: responseKind,
        text: currentState.response,
      }].slice(-8));
    }, 1740);
    return () => {
      window.clearTimeout(evidenceTimer);
      window.clearTimeout(criteriaTimer);
      window.clearTimeout(observationTimer);
      window.clearTimeout(actionReasoningTimer);
      window.clearTimeout(responseTimer);
    };
  }, [currentState, isExecution, stageIndex]);

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
          <strong>Agent Live Observation Session</strong>
        </div>
        <div className="header-actions">
          <span className="camera-health" role="status" aria-live="polite"><i aria-hidden="true" /> Cameras {liveCount} / 3{remoteCameraMode ? ' · 10Hz' : ''}</span>
          <button className="settings-button" type="button" onClick={() => setControlsOpen(true)}>Scene Control</button>
        </div>
      </header>

      <div className={`workspace ${isExecution ? 'execution-layout' : 'planning-layout'}`}>
        {!isExecution && (
          <aside className="sequence-panel" aria-label="Generated task plan">
            <div className="sequence-heading">
              <span>{planStatus}</span>
              <h2>Task Plan</h2>
              <p>{planningHeadline}</p>
            </div>
            <div className="phase-list planning-phase-list">
              {PLAN_STEPS.slice(0, generatedPlanCount).map((step, index) => (
                <div className="generated" key={step.title}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div className="plan-step-copy">
                    <strong>{step.title}</strong>
                    <small>{step.executor} · {step.detail}</small>
                  </div>
                  <i aria-hidden="true" />
                </div>
              ))}
              {planningProgress >= 1 && !planReady && generatedPlanCount < PLAN_STEPS.length && (
                <div className="generating">
                  <span>{String(generatedPlanCount + 1).padStart(2, '0')}</span>
                  <div className="plan-step-copy"><strong>Generating next step</strong><small>Resolving dependencies and actor</small></div>
                  <i aria-hidden="true" />
                </div>
              )}
              {planningProgress < 1 && <div className="plan-empty">Plan steps will appear here as the instruction is analyzed.</div>}
            </div>
            <div className="run-details planning-details">
              <div><span>Source</span><strong>{instructionFile ? 'LOCAL FILE' : 'WAITING'}</strong></div>
              <div><span>Generated</span><strong>{instructionFile ? `${generatedPlanCount} / ${PLAN_STEPS.length}` : '—'}</strong></div>
            </div>
          </aside>
        )}

        {!isExecution ? (
          <section className="planning-workspace" aria-label="Instruction analysis and plan generation">
            <article className="instruction-card">
              <header><span>WORK INSTRUCTION</span><strong>{instructionFile ? 'LOCAL FILE' : 'NO FILE'}</strong></header>
              <input
                ref={fileInputRef}
                className="instruction-input"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                onChange={(event) => {
                  const [file] = Array.from(event.currentTarget.files ?? []);
                  if (file) loadInstruction(file);
                  event.currentTarget.value = '';
                }}
              />
              {instructionFile ? (
                <div className="instruction-preview">
                  <div className="document-title"><span>LOCAL REFERENCE</span><strong>{instructionFile.name}</strong><small>{Math.max(1, Math.round(instructionFile.size / 1024))} KB · not uploaded</small></div>
                  <div className="document-section"><span>Selected demo profile</span><strong>Mainboard component installation</strong></div>
                  <div className="document-grid">
                    <div><span>Components</span><strong>GPU · RAM · driver · mainboard · power cable</strong></div>
                    <div><span>Actors</span><strong>Robot · Human · Agent</strong></div>
                    <div><span>Completion</span><strong>Visual verification after every physical task</strong></div>
                    <div><span>Safety</span><strong>Human proximity hold and force-limited recovery</strong></div>
                  </div>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>Replace instruction</button>
                </div>
              ) : (
                <div className="instruction-empty">
                  <span>LOCAL INPUT</span>
                  <h1>Load a drawing or work instruction</h1>
                  <p>The file stays on this device as a session reference. A predefined demo profile generates the plan.</p>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>Load instruction</button>
                </div>
              )}
            </article>

            <article className="planning-agent-panel" aria-live="polite">
              <header><div><span>AGENT PLANNING</span><strong>{planStatus}</strong></div></header>
              <ol className="planning-event-list">
                {planningProgress < 0 ? (
                  <li className="planning-idle"><span>READY</span><strong>Planning begins when a local instruction is selected.</strong></li>
                ) : PLANNING_EVENTS.slice(0, planningProgress + 1).map((event, index) => (
                  <li className={index === planningProgress ? 'current' : 'complete'} key={event.label}>
                    <span>{index === planningProgress && !planReady ? 'RUNNING' : 'COMPLETE'}</span>
                    <div><strong>{event.label}</strong><small>{event.detail}</small></div>
                  </li>
                ))}
              </ol>
              {planReady && <button className="begin-observation-button" type="button" onClick={() => selectStage(4)}>Begin live observation</button>}
            </article>
          </section>
        ) : (
          <section className="camera-workspace execution-workspace" aria-label="Camera workspace">
            <nav className="plan-ribbon" aria-label="Active task plan">
              <span>PLAN ACTIVE</span>
              <div>
                {PLAN_STEPS.map((step, index) => (
                  <div className={index === currentState.phase ? 'active' : index < currentState.phase ? 'done' : ''} key={step.title}>
                    <i aria-hidden="true" /><strong>{step.title}</strong>
                    <small className={actorClass(step.executor)}>{step.executor}</small>
                    {index === currentState.phase && RECOVERY_STATE_IDS.has(currentState.id) && <em>{currentState.status}</em>}
                  </div>
                ))}
              </div>
            </nav>

            <section className="camera-grid" aria-label="Three live cameras">
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
                          alt={`${CAMERA_NAMES[slot]} RealSense live feed`}
                          decoding="async"
                          onLoad={() => setCameraStatuses((previous) => previous.map((current, index) => index === slot ? 'live' : current))}
                          onError={() => setCameraStatuses((previous) => previous.map((current, index) => index === slot ? 'error' : current))}
                        />
                      ) : (
                        <video aria-label={`${CAMERA_NAMES[slot]} live feed`} autoPlay muted playsInline ref={(element) => {
                          videoRefs.current[slot] = element;
                          if (element && streamsRef.current[slot]) element.srcObject = streamsRef.current[slot];
                        }} />
                      )}
                      {remoteCameraMode && depthLive && (
                        <div className="depth-pip" aria-label={`${CAMERA_NAMES[slot]} depth feed`}>
                          <span>DEPTH</span>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/depth-stream/${slot}`} alt="" aria-hidden="true" />
                        </div>
                      )}
                      <div className="camera-placeholder" aria-hidden={status === 'live'}>
                        <div className="camera-placeholder-copy"><strong>{cameraPlaceholderLabel(status)}</strong><span>{cameraMessageLabel(cameraErrors[slot]) || (remoteCameraMode ? 'Checking the RealSense stream' : 'Connect a camera in Scene Control')}</span></div>
                      </div>
                    </div>
                    <div className="camera-actions">
                      <button type="button" onClick={() => setFeaturedCamera(slot)} disabled={isFeatured}>Primary</button>
                      <button className="expand-camera-button" type="button" onClick={() => setExpandedCamera(slot)} disabled={status !== 'live'}>Expand</button>
                    </div>
                  </article>
                );
              })}
            </section>

            <section className="operation-panel" aria-label="Current agent decision">
              <div className="operation-copy">
                <div className="operation-kicker"><span>{currentState.protocol}</span><strong>{currentState.status}</strong><em className={actorClass(currentState.actor)}>{currentState.actor}</em></div>
                <h1>{currentState.headline}</h1>
                <p>{currentState.detail}</p>
              </div>
              <div className="decision-trace">
                <div><span>Observation</span><strong>{currentState.observation}</strong></div>
                <div><span>Decision · Action</span><strong>{currentState.response}</strong></div>
              </div>
            </section>

            <section className="agent-trace-panel" aria-label="Agent trace" aria-live="polite">
              <header><div><span>AGENT TRACE</span><strong>Predefined · stage-linked</strong></div></header>
              <ol>
                {agentTrace.map((event) => (
                  <li className={`trace-${event.kind.toLowerCase()}`} key={event.id}>
                    <span>{event.kind}</span><strong>{event.text}</strong>
                  </li>
                ))}
                {reasoningTrace && (
                  <li className="trace-reasoning" key={reasoningTrace.id}>
                    <span>{reasoningTrace.label}</span><strong>{reasoningTrace.text}</strong>
                  </li>
                )}
              </ol>
            </section>
          </section>
        )}
      </div>

      {expandedCamera !== null && (
        <section className="camera-overlay" role="dialog" aria-modal="true" aria-label={`CAM 0${expandedCamera + 1} expanded view`} onClick={() => setExpandedCamera(null)}>
          <div className="camera-overlay-header" onClick={(event) => event.stopPropagation()}>
            <div><span>CAM 0{expandedCamera + 1}</span><strong>{CAMERA_NAMES[expandedCamera]}</strong></div>
            <button ref={expandedCloseButtonRef} type="button" onClick={() => setExpandedCamera(null)} aria-label="Close expanded view">Close</button>
          </div>
          <div className="camera-overlay-viewport" onClick={(event) => event.stopPropagation()}>
            {remoteCameraMode ? (
              // MJPEG is a continuous multipart response and must use a native img element.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="remote-stream" src={`/camera-stream/${expandedCamera}`} alt={`${CAMERA_NAMES[expandedCamera]} RealSense expanded feed`} />
            ) : (
              <video ref={expandedVideoRef} aria-label={`${CAMERA_NAMES[expandedCamera]} expanded feed`} autoPlay muted playsInline />
            )}
            {remoteCameraMode && remoteCameras.find((camera) => camera.slot === expandedCamera)?.depth?.status === 'live' && (
              <div className="depth-pip depth-pip-expanded" aria-label={`${CAMERA_NAMES[expandedCamera]} depth feed`}>
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
          <div><h2>Scene Control</h2></div>
          <button ref={closeButtonRef} type="button" onClick={() => setControlsOpen(false)} aria-label="Close scene control">×</button>
        </div>
        <section className="control-section">
          <div className="control-section-heading"><h3>Scene State</h3><span>← / →</span></div>
          <div className="stage-nav-buttons"><button type="button" onClick={() => moveStage(-1)} disabled={stageIndex === 0}>Previous</button><button type="button" onClick={() => moveStage(1)} disabled={stageIndex === STAGE_STATES.length - 1}>Next</button></div>
          <div className="state-list">
            {STAGE_STATES.map((state, index) => (
              <button className={index === stageIndex ? 'active' : ''} type="button" key={state.id} onClick={() => selectStage(index)}><span>{state.scene}</span><strong>{state.status}</strong></button>
            ))}
          </div>
        </section>
        <section className="control-section camera-control-section">
          <div className="control-section-heading"><h3>{remoteCameraMode ? 'RealSense Input' : 'Camera Input'}</h3><span>{liveCount} / 3 connected</span></div>
          {remoteCameraMode ? (
            <>
              <p className="camera-message">{cameraMessageLabel(cameraSummary)}</p>
              <div className="remote-camera-list">
                {CAMERA_NAMES.map((name, slot) => {
                  const camera = remoteCameras.find((item) => item.slot === slot);
                  return <div key={name}><strong>CAM 0{slot + 1} · {name}</strong><span>{camera?.status === 'live' ? `${camera.width}×${camera.height} · ${camera.fps?.toFixed(1) ?? '0.0'}Hz` : cameraMessageLabel(camera?.error || '연결 확인 중')}</span></div>;
                })}
              </div>
            </>
          ) : (
            <>
              <button className="connect-button" type="button" onClick={connectAllCameras} disabled={isConnectingAll}>{isConnectingAll ? 'Connecting cameras…' : 'Connect three cameras'}</button>
              <p className="camera-message">{cameraMessageLabel(cameraSummary)}</p>
              <div className="device-selects">
                {CAMERA_NAMES.map((name, slot) => (
                  <label key={name}><span>CAM 0{slot + 1} · {name}</span>
                    <select value={selectedDeviceIds[slot]} onChange={(event) => changeCameraDevice(slot, event.target.value)} disabled={isConnectingAll}>
                      <option value="">Select camera</option>
                      {selectedDeviceIds[slot] && !devices.some((device) => device.deviceId === selectedDeviceIds[slot]) && (
                        <option value={selectedDeviceIds[slot]}>Disconnected camera</option>
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
        <section className="shortcut-guide"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> switch primary view</span><span><kbd>ESC</kbd> close control</span></section>
      </aside>
    </main>
  );
}
