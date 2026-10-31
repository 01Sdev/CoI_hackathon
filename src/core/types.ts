// ERD 엔티티 8개(Session, Plugin, SceneDecision, LogEntry, Delivery, Detection, Counter, UsageSample).
// 근거: docs/specs/04-ERD.md §3. ERD에 없던 필드는 docs/designs/core-store.md §2.3에 적었다.
// 시간은 performance.now() 기준 ms(IF-07 OutwardMessage.at만 Date.now()).

import type { Manifest } from './manifest';

export type SceneLabel = 'food' | 'person' | 'none';
export type InputKind = 'webcam' | 'rear' | 'video';
export type ViewMode = 'phone' | 'desktop' | 'hud' | 'outward';
export type PluginKind = 'calorie' | 'tamper' | 'hello';
export type PluginStatus = 'loading' | 'ready' | 'stopped' | 'terminated';
export type Branch = '2a' | '2b' | '2c' | '2d' | 'raw';
export type DeliveryBranch = Exclude<Branch, '2d'>;
export type LogKind = 'deliver' | 'hold' | 'skip' | 'violation';
export type Enforced = 'host' | 'plugin-report';
export type SendStatus = 'prepared' | 'dispatched' | 'failed';
export type AckStatus = 'pending' | 'match' | 'mismatch' | 'timeout';
export type MaskKind = 'none' | 'face' | 'head';

/** 좌표. 단위는 필드 설명을 따른다(0~1 비율 또는 원본 px). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InputSource {
  kind: InputKind;
  width: number;
  height: number;
  fps: number;
  fallbackFrom: InputKind | null;
}

export interface Session {
  id: string;
  startedAt: number;
  viewMode: ViewMode;
  /** 실제로 열린 입력. A가 쓴다. */
  input: InputSource | null;
  /** C가 요청한 입력. A가 보고 처리한다. seq는 요청마다 오르므로 같은 입력을 다시 요청해도 바뀐다. */
  inputRequest: { kind: InputKind; seq: number } | null;
  compareMode: boolean;
  /** 전달 일시 정지(F20, 발표자 화면 전용). */
  paused: boolean;
  /** 전송 범위 프레임(F24). 소스 프레임 기준 0~1. C만 setCaptureFrame으로 쓰고, A는 포착을 시작할 때 한 번 읽는다. 새 세션에도 유지. */
  captureFrame: Box;
}

export interface VersionedManifest extends Manifest {
  /** A(스토어 applyManifest)가 매긴다. JSON에는 없다. */
  version: number;
}

/** 지금 돌고 있는 iframe이 어떤 정책으로 만들어졌는지. B가 iframe을 만들 때 쓴다. */
export interface RuntimePolicy {
  /** 'none' = connect-src 'none'·apiBase null(비교 모드의 칼로리). 'network' = allowedOrigins. */
  connect: 'none' | 'network';
  manifestVersion: number;
}

export interface Plugin {
  id: string;
  sessionId: string;
  kind: PluginKind;
  /** iframe을 새로 만들 때마다 바뀐다. iframe이 없으면 null. */
  runtimeId: string | null;
  /** 지금 iframe의 정책. iframe이 없으면 null. */
  runtimePolicy: RuntimePolicy | null;
  /** loading = 전환·생성 중, ready = 받을 수 있음, stopped = 전환 실패, terminated = 꺼짐(사용자 끔·재로드 위반). */
  status: PluginStatus;
  /** 전달 게이트. 전환 공통 절차 ①에서 닫고 ⑤에서 연다. 일시 정지는 여기 섞지 않는다(selectCanSend). */
  gateOpen: boolean;
  /** 사용자 의도(켜기/끄기). status는 B가 쓰는 실제 상태. */
  enabled: boolean;
  cooldownUntil: number;
  /** 포착 진행 중. */
  busy: boolean;
  manifest: VersionedManifest;
  /** 파생: network ∩ HOST_ALLOWED_ORIGINS, $ORIGIN 치환 후. */
  allowedOrigins: string[];
}

export interface SceneDecision {
  id: string;
  sessionId: string;
  label: SceneLabel;
  /** COCO 영문 물체 라벨(pizza 등). x-label·고정표 키. */
  objectLabel: string;
  /** 소스 프레임 기준 0~1. */
  targetBox: Box;
  score: number;
  confirmedAt: number;
}

export interface LogEntry {
  id: string;
  sessionId: string;
  pluginId: string;
  sceneDecisionId: string | null;
  deliveryId: string | null;
  kind: LogKind;
  branch: Branch | null;
  reason: string;
  enforcedBy: Enforced | null;
  at: number;
  /** 그 포착에 쓴 전송 범위 프레임(F24, 원본 px). deliver와 hold "프레임 밖"에 남긴다. 다른 줄에는 없다. */
  frameRect?: Box | null;
}

export type FaceCheck = { status: 'checked'; detectedFaces: number } | { status: 'error'; detectedFaces: null };

export interface Delivery {
  id: string;
  pluginId: string;
  manifestVersion: number;
  /** 포착을 시작할 때의 Plugin.runtimeId. 다르면 sendDelivery가 거부한다. */
  runtimeId: string;
  scene: SceneLabel;
  objectLabel: string;
  sendStatus: SendStatus;
  branch: DeliveryBranch;
  /** 보낸 Blob의 size. */
  bytes: number;
  /** 보낸 이미지의 픽셀 크기. */
  width: number;
  height: number;
  /** 실제로 자른 cropRect 면적 / 원본 프레임 면적. */
  areaRatio: number;
  /** 원본 px. */
  cropRect: Box;
  /**
   * 포착을 시작할 때 읽은 Session.captureFrame을 원본 px로 바꾼 값(F24). cropRect ⊆ frameRect(raw는 같음).
   * F24를 구현하기 전의 호출과 맞도록 선택 필드로 둔다. A가 구현하면 늘 채운다.
   * prepareDelivery는 cropRect가 이 안에 없으면, raw는 이 값이 없거나 cropRect와 다르면 받지 않는다.
   */
  frameRect?: Box;
  facesMasked: number;
  faceCheck: FaceCheck;
  processedAt: number;
  location: 'browser';
  sha256: string;
  ackSha256: string | null;
  ackStatus: AckStatus;
  /**
   * 보낸 Blob을 줄인 썸네일의 object URL. LogEntry가 밀려날 때 스토어가 해제한다. 단, 사용 기록 대표 조각(F25)이
   * 같이 쓰고 있으면 그 조각이 빠질 때 해제한다. raw는 비교 모드를 끌 때 null.
   */
  thumbnailRef: string | null;
  /** 플러그인에 보낸 것과 같은 Blob 객체(IF-02). raw는 비교 모드를 끌 때 null. */
  blob: Blob | null;
}

export interface Detection {
  id: string;
  logEntryId: string;
  kind: 'person' | 'face';
  /** 조각 기준 0~1. */
  box: Box;
  score: number;
  /** 사람 박스 ∩ 조각 / 조각. 얼굴이면 null. */
  overlap: number | null;
  masked: MaskKind;
}

export interface RecentFaceRecord {
  at: number;
  pluginId: string;
  detectedFaces: number;
}

/** window60s의 기록 한 건. 증가분만 담고 selector가 60초 창으로 더한다. */
export interface ThroughputRecord {
  at: number;
  stage0Runs: number;
  faceDetectRuns: number;
  sourceFrames: number;
  deliveries: number;
  holds: number;
}

export interface Counter {
  sessionId: string;
  /** F25 사용 기록. dispatched 전달마다 1줄, 증가 전용, 이미지 없음. 화면 로그 100건과 따로 세션 동안 남는다. */
  usage: UsageRecord[];
  /** dispatched 전달의 faceCheck 기록. 10초 지나면 빠진다. 비교 모드를 꺼도 빼지 않는다. */
  recent10s: RecentFaceRecord[];
  window60s: ThroughputRecord[];
  /** 증가 전용. */
  perPlugin: Record<string, { deliveries: number; faceDeliveries: number }>;
  /** 원본 서버 전송. 항상 0이어야 한다. */
  rawServerSends: number;
  apiSends: number;
}

/** HUD 실시간 표시(저장 엔티티 아님). A가 5fps로 쓴다. */
export interface LiveObservation {
  label: SceneLabel;
  objectLabel: string | null;
  targetBox: Box | null;
  /** "화면 속 N명". */
  peopleCount: number;
  at: number;
}

/** 플러그인 결과 줄(UI 상태, 최신 1줄). text는 textContent로만 표시. */
export interface ResultLine {
  deliveryId: string;
  text: string;
  source: 'api' | 'fallback';
  at: number;
}

/** F25 사용 기록 한 줄("OO 플러그인에서 사용됨"). */
export interface UsageRecord {
  at: number;
  pluginId: string;
  deliveryId: string;
  objectLabel: string;
  bytes: number;
  /** Delivery.frameRect의 크기. F24 구현 전 전달이면 null. */
  frameW: number | null;
  frameH: number | null;
}

/** F25 대표 조각. 플러그인별 최근 USAGE_SAMPLES_PER_PLUGIN장, raw는 남기지 않는다. */
export interface UsageSample {
  pluginId: string;
  deliveryId: string;
  at: number;
  /** 그 Delivery의 thumbnailRef를 같이 쓴다. 로그에서 밀려나도 여기 남아 있으면 해제하지 않는다. */
  thumbnailRef: string;
}
