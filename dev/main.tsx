// /dev/ 트랙 A 확인 페이지. 개발 서버에서만 열린다(02-SSRD §1 "/dev/* 테스트 페이지는 프로덕션 빌드에서 제외").
// 쿼리: ?video=/dev/fixtures/x.mp4 녹화 입력 파일, ?input=webcam|rear|video 시작 입력.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { lensStore } from '../src/core/store';
import type { InputKind } from '../src/core/types';
import { setVideoUrl } from '../src/input/adapter';
import { startRuntime } from '../src/vision';
import { DevPage } from './DevPage';

const params = new URLSearchParams(location.search);
const videoParam = params.get('video');
if (videoParam) setVideoUrl(videoParam);
const inputParam = params.get('input');
if (inputParam === 'webcam' || inputParam === 'rear' || inputParam === 'video') {
  lensStore.getState().selectInput(inputParam as InputKind);
}

// React 밖에서 한 번(StrictMode 이중 실행과 무관하게).
startRuntime();

const root = document.getElementById('root');
if (!root) throw new Error('#root 없음');
createRoot(root).render(
  <StrictMode>
    <DevPage />
  </StrictMode>,
);
