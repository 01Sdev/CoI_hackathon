// 트랙 A 판정·가림 설정값. 근거: docs/specs/03-SRS.md FR-006~018·FR-051, §4.1·§4.2, 05-코드-전-결정사항 리허설 튜닝 표.
// 기준값은 리허설에서 이 파일만 고쳐 바꾼다(FR-051). 코드 안에 숫자를 다시 쓰지 않는다.

/**
 * 모델 파일 위치. 파일은 사용자가 직접 골라 public/models/에 둔다(PROGRESS.md "모델 파일").
 * 다른 파일을 쓰려면 이 두 경로만 바꾼다. 파일이 없으면 판정이 멈추고 상태가 'missing'이 된다.
 */
export const MODEL_PATHS = {
  /** MediaPipe ObjectDetector용 .tflite(메타데이터 포함, COCO pizza·person 클래스). 명세 기준 EfficientDet-Lite0. */
  object: '/models/efficientdet_lite0.tflite',
  /** MediaPipe FaceDetector용 .tflite. 명세 기준 BlazeFace short-range. */
  face: '/models/blaze_face_short_range.tflite',
  /** MediaPipe ImageSegmenter용 Selfie Multiclass(256×256, 16.4MB). 2b·2c 가림 모양(F23, FR-016a). 없으면 박스·사각형 전체를 가린다. */
  selfie: '/models/selfie_multiclass_256x256.tflite',
} as const;

/** public/wasm/ (postinstall이 node_modules/@mediapipe/tasks-vision/wasm/을 복사한다). CDN은 쓰지 않는다. */
export const WASM_BASE = '/wasm';

/**
 * COCO 음식 라벨 12종. 10종은 고정 칼로리표(02-SSRD IF-08)와 같고 bowl·cup은 음식 맥락(PRD 위험 표).
 * 05 결정 21의 "AGENTS.md 원문"은 레포 AGENTS.md에 없어 이 두 출처로 만들었다.
 */
export const FOOD_LABELS: readonly string[] = [
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'bowl',
  'cup',
];

export const VISION_CONFIG = {
  // ── 0단계(FR-006~009) ──
  /** 0단계 입력의 긴 변(px). 비율 유지(K-10). */
  stage0LongSide: 640,
  /** 0단계 목표 간격(ms). 5fps. */
  stage0IntervalMs: 200,
  /** ObjectDetector가 돌려주는 최소 점수. 아래 단계별 기준은 이보다 높거나 같아야 한다. */
  detectorScoreFloor: 0.3,
  /** 0단계에서 음식·사람 후보로 보는 최소 점수. */
  stage0ScoreMin: 0.4,
  /** 판정 영역: 화면 가운데, 가로·세로 각각 이 비율(K-09). 박스 중심이 이 안에 있어야 후보. */
  centerRegion: 0.6,
  /** 사람 대상 하한: 프레임 면적 대비(장면 선택에만 쓴다). */
  personMinArea: 0.05,
  /** 같은 라벨이 이만큼 이어지면 장면 확정(ms). */
  confirmMs: 1000,

  // ── 1단계 포착(FR-011·013) ──
  /** 대상 박스를 변마다 넓히는 비율. */
  targetExpand: 0.1,
  /** 포착 프레임 재검출에서 사람으로 보는 최소 점수(안전 검사라 0단계보다 낮게, 필터 없음). */
  safetyPersonScoreMin: 0.3,
  /** 포착 프레임 재검출에서 대상(같은 라벨)으로 보는 최소 점수. */
  recheckTargetScoreMin: 0.3,

  // ── 2단계 가림·분기(FR-013~017, §4.2) ──
  /** O: 사람 박스 ∩ 조각 > 조각 면적의 이 비율. */
  overlapMin: 0.05,
  /** P(보류): 사람 박스 ∩ 조각 ≥ 조각 면적의 이 비율. */
  holdOverlap: 0.5,
  /** F: BlazeFace 신뢰도. */
  faceScoreMin: 0.5,
  /** 얼굴 검출 전에 조각의 긴 변이 이보다 작으면 이 크기로 키운다. */
  faceMinSide: 256,
  /** 2b: 얼굴 박스를 변마다 넓히는 비율. */
  faceExpand: 0.15,
  /** 2c: 사람 박스 위쪽 비율. */
  headTop: 0.4,
  /** 2c: 머리 영역 좌우 여유(사람 박스 폭 대비, 변마다). */
  headSide: 0.1,
  /** 픽셀화 격자(가로·세로 칸 수). */
  pixelGrid: 6,

  // ── Selfie 모양 가림(F23, FR-016a) ──
  /** 가릴 Selfie 클래스: 1 머리카락, 3 얼굴 피부. */
  selfieClasses: [1, 3] as readonly number[],
  /** 마스크 팽창 반지름 = 조각 긴 변 × 이 비율(최소 selfieDilateMinPx). */
  selfieDilateRatio: 0.02,
  selfieDilateMinPx: 3,
  /** 2b(얼굴 박스) 안에서 모양으로 가린다. false면 박스 전체. */
  selfieShapeFace: true,
  /** 2c(머리 영역) 안에서 모양으로 가린다. V2·V3에서 사각형보다 덜 가린 사례가 나오면 false(사각형 전체 = 사각형 ∪ Selfie). */
  selfieShapeHead: true,

  // ── 코디 스캔 응시 동의(docs/designs/outfit-pipelines.md). 3초·원 반지름·동의 수명은 core 상수(GAZE_*·CONSENT_*) ──
  /** 틱 사이 사람 상자를 같은 사람으로 잇는 최소 IoU. */
  trackIouMin: 0.3,
  /** 안 보인 추적을 남겨 두는 시간(ms). CONSENT_LOST_MS와 같게 두어 짧게 가려진 사람의 동의가 이어지게 한다. */
  trackKeepMs: 2000,
  /** 응시 대상이 이만큼 안 비면 3초를 이어 센다(ms). 검출이 한두 틱 빠지는 정도. */
  gazeGraceMs: 400,
  /** 포착 프레임 재검출에서 동의 상자와 같은 사람으로 보는 최소 IoU. */
  consentMatchIouMin: 0.3,

  // ── 비교 모드(F17) ──
  /** raw JPEG 품질. 해상도는 원본 그대로(05 결정 30). */
  rawQuality: 0.8,
} as const;

export type VisionConfig = typeof VISION_CONFIG;
