// /dev/ 트랙 A 확인 페이지. 개발 서버에서만 열린다(02-SSRD §1 "/dev/* 테스트 페이지는 프로덕션 빌드에서 제외").
// 쿼리: ?video=/dev/fixtures/x.mp4 녹화 입력 파일, ?input=webcam|rear|video 시작 입력, ?mock=0 B 목 호스트 끄기.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { lensStore } from '../src/core/store';
import type { InputKind } from '../src/core/types';
import { setVideoUrl } from '../src/input/adapter';
import { startRuntime } from '../src/vision';
import { VISION_CONFIG } from '../src/vision/config';
import { detectFaces, detectObjects, getModels } from '../src/vision/models';
import { segmentCategories } from '../src/vision/segmenter';
import { DevPage } from './DevPage';
import { startMockHost } from './mockHost';

const params = new URLSearchParams(location.search);
const videoParam = params.get('video');
if (videoParam) setVideoUrl(videoParam);
const inputParam = params.get('input');
if (inputParam === 'webcam' || inputParam === 'rear' || inputParam === 'video') {
  lensStore.getState().selectInput(inputParam as InputKind);
}

// 콘솔 확인용(개발 서버 전용 페이지라 프로덕션에는 없다). config는 FR-055 주입 시험(일부러 덜 가리기)에 쓴다.
Object.assign(window, { __devA: { getModels, detectFaces, detectObjects, segmentCategories, config: VISION_CONFIG } });

// React 밖에서 한 번(StrictMode 이중 실행과 무관하게).
if (params.get('mock') !== '0') startMockHost();
startRuntime();

const root = document.getElementById('root');
if (!root) throw new Error('#root 없음');
createRoot(root).render(
  <StrictMode>
    <DevPage />
  </StrictMode>,
);
