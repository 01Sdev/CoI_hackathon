// 로그 한 줄의 상세. 해시(호스트 계산값과 플러그인 ack)는 여기에만 둔다(FR-027). 해시는 보장 근거가 아니다.
// 검출(Detection)은 글자로만 보인다. 사람·얼굴 위치를 그림으로 그리지 않는다.

import { useLensStore } from '../core/store';
import type { Detection } from '../core/types';
import { formatBytes, objectName, PLUGIN_NAME, SCENE_LABEL } from '../ui/labels';
import { ago, entryCode, entryMeta, entryTitle, entryTone, percent } from './format';
import { Thumb, useNow } from './ProofLog';

const ACK_TEXT = { pending: '확인 기다리는 중', match: '수신 확인 · 해시 일치', mismatch: '해시 불일치(차단 기록)', timeout: '수신 미확인(2초 초과)' };
const SEND_TEXT = { prepared: '보내는 중', dispatched: '보냄', failed: '전송 실패(수에 넣지 않음)' };

function detectionText(d: Detection): string {
  const who = d.kind === 'face' ? '얼굴' : '사람';
  const mask = d.masked === 'face' ? ' · 얼굴 가림' : d.masked === 'head' ? ' · 머리 넓게 가림' : '';
  const overlap = d.overlap !== null ? ` · 조각과 겹침 ${percent(d.overlap)}` : '';
  return `${who} ${d.score.toFixed(2)}${overlap}${mask}`;
}

export function DeliveryDetail({ entryId, onBack }: { entryId: string; onBack(): void }) {
  const entry = useLensStore((s) => s.logs.find((l) => l.id === entryId) ?? null);
  const d = useLensStore((s) => (entry?.deliveryId ? (s.deliveries[entry.deliveryId] ?? null) : null));
  const kind = useLensStore((s) => (entry ? s.plugins[entry.pluginId]?.kind : undefined));
  const scene = useLensStore((s) => (entry?.sceneDecisionId ? (s.sceneDecisions[entry.sceneDecisionId] ?? null) : null));
  const dets = useLensStore((s) => (entry ? s.detections[entry.id] : undefined));
  const now = useNow();

  if (!entry) {
    return (
      <section className="fm-detail">
        <p className="fm-readout">이 줄은 최근 100건에서 밀려나 지워졌습니다.</p>
        <button type="button" className="fm-btn fm-glass" onClick={onBack}>
          목록으로
        </button>
      </section>
    );
  }

  const rows: Array<[string, string]> = [['플러그인', kind ? PLUGIN_NAME[kind] : entry.pluginId], ['시각', ago(now - entry.at)]];
  if (scene) rows.push(['장면', `${SCENE_LABEL[scene.label]} · ${objectName(scene.objectLabel)} ${scene.score.toFixed(2)}`]);
  if (d) {
    rows.push(
      ['보낸 바이트', `${formatBytes(d.bytes)} (${d.bytes.toLocaleString('ko-KR')}B)`],
      ['크기', `${d.width}×${d.height}px`],
      ['원본 대비 면적', percent(d.areaRatio)],
      ['자른 영역(원본 px)', `${Math.round(d.cropRect.x)}, ${Math.round(d.cropRect.y)} · ${Math.round(d.cropRect.w)}×${Math.round(d.cropRect.h)}`],
      ['가린 얼굴', `${d.facesMasked}개`],
      ['출구 재검사', d.faceCheck.status === 'checked' ? `얼굴 ${d.faceCheck.detectedFaces}개 검출` : '검사 실패'],
      ['처리 위치', '이 기기(브라우저)'],
      ['전송', SEND_TEXT[d.sendStatus]],
      ['수신 확인', ACK_TEXT[d.ackStatus]],
      ['매니페스트 버전', `v${d.manifestVersion}`],
    );
  } else if (entry.kind !== 'deliver') {
    rows.push(['사유', entryMeta(entry, null)]);
  }

  return (
    <section className="fm-detail" data-tone={entryTone(entry, d)} aria-label="로그 상세">
      <div className="fm-detail__head">
        <button type="button" className="fm-btn fm-btn--sm fm-glass" onClick={onBack}>
          ← 목록
        </button>
        <span className="fm-label fm-detail__title">
          <span className="fm-dot" aria-hidden="true" />
          {entryTitle(entry, d, kind)}
          {entryCode(entry) && <span className="fm-tag">{entryCode(entry)}</span>}
        </span>
      </div>
      <div className="fm-detail__body">
        <Thumb entry={entry} delivery={d} />
        <dl className="fm-kv">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="fm-readout">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {d && (
        <dl className="fm-kv fm-kv--hash">
          <div>
            <dt className="fm-readout">SHA-256 · 호스트</dt>
            <dd className="fm-hash">{d.sha256}</dd>
          </div>
          <div>
            <dt className="fm-readout">SHA-256 · 플러그인 ack</dt>
            <dd className="fm-hash">{d.ackSha256 ?? '없음'}</dd>
          </div>
        </dl>
      )}
      {dets && dets.length > 0 && (
        <div className="fm-detail__dets">
          <span className="fm-kicker">detections</span>
          <ul>
            {dets.map((x) => (
              <li key={x.id} className="fm-readout">
                {detectionText(x)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="fm-readout">해시는 받은 쪽이 같은 파일을 받았는지 보는 보조 확인입니다. 보장의 근거는 위 바이트·분기·재검사 값입니다.</p>
    </section>
  );
}
