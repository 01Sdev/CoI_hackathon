// 플러그인 화면 자리(사용자 결정 2026-11-01, FR-034). framelet은 흰 틀과 사람 아이콘·숫자만 그리고, 앱 결과는
// 플러그인 종류마다 호스트가 고른 화면 하나가 그린다. 앱을 갈아 끼워도 흰 틀은 그대로다. core는 바꾸지 않는다.
// 칼로리 = 금빛 상태창(FoodStatusPanel)과 0단계 대상 박스 중심에서 나오는 금빛 연결선. 연결선은 이 화면만 쓴다.
// 장면 기록 = 작은 글자 카드. 변조 시험 = framelet이 막은 횟수와 마지막 사유 카드(차단 시연. 글래스 흐름에는 기록 화면이 없다).
// 앱 문자열은 sanitizeAppText를 거쳐 textContent로만 들어간다.

import { useEffect, useState, type ComponentType } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLensStore } from '../core/store';
import type { PluginKind, ResultLine } from '../core/types';
import { FoodStatusPanel } from './FoodStatusPanel';
import { boxCenter, type Size } from './geometry';
import { CALORIE_PANEL_HOLD_MS, caloriePanelHidden, calorieView } from './labels';
import { logReason } from '../proof/format';
import { sanitizeAppText } from './sanitize';

interface PluginViewProps {
  pluginId: string;
  /** 그 앱의 마지막 결과. 아직 없으면 null이고, 그릴 것이 없으면 화면이 null을 돌려준다. */
  line: ResultLine | null;
  size: Size;
}

const PLUGIN_VIEW: Record<PluginKind, ComponentType<PluginViewProps> | null> = {
  calorie: CalorieView,
  hello: SceneNoteView,
  tamper: TamperView,
  // 코디 스캔 화면(말 막대·질문·답 패널)은 결과 한 줄이 아니라 동의·질문에 따라 뜨므로 Hud가 OutfitTalk로 따로 그린다.
  outfit: null,
};

/** 켜져 있는 앱마다 그 앱의 화면을 그린다(pluginOrder 순). */
export function PluginViews({ size }: { size: Size }) {
  const results = useLensStore((s) => s.results);
  const plugins = useLensStore((s) => s.plugins);
  const order = useLensStore((s) => s.pluginOrder);
  return (
    <>
      {order.map((id) => {
        const p = plugins[id];
        const View = p?.enabled ? PLUGIN_VIEW[p.kind] : null;
        return View ? <View key={id} pluginId={id} line={results[id] ?? null} size={size} /> : null;
      })}
    </>
  );
}

/** 결과가 아직 없는 최신 전달이 있으면 "— kcal"로 먼저 띄우고, 결과가 오면 같은 창(id = deliveryId)에서 숫자로 바뀐다. */
function CalorieView({ pluginId, line, size }: PluginViewProps) {
  const v = useLensStore(
    useShallow((s) => {
      // 이 앱에 마지막으로 보낸 전달. 결과(line)가 이것보다 옛 전달이면 아직 계산 중이다.
      let latest: { id: string; objectLabel: string; at: number } | null = null;
      for (const d of Object.values(s.deliveries)) {
        if (d.pluginId === pluginId && d.sendStatus === 'dispatched' && (!latest || d.processedAt > latest.at))
          latest = { id: d.id, objectLabel: d.objectLabel, at: d.processedAt };
      }
      return {
        latestId: latest?.id ?? null,
        latestLabel: latest?.objectLabel ?? '',
        box: s.liveObservation?.label === 'food' ? s.liveObservation.targetBox : null,
        srcW: s.session.input?.width ?? 0,
        srcH: s.session.input?.height ?? 0,
      };
    }),
  );
  // 음식이 판정 영역에서 안 보이게 되면 CALORIE_PANEL_HOLD_MS 뒤 상태창을 내린다. 다시 보이면 바로 다시 띄운다(새 음식이면 새 창).
  const foodSeen = v.box !== null;
  const [goneAt, setGoneAt] = useState<number | null>(() => (foodSeen ? null : Date.now()));
  const [, rerender] = useState(0);
  useEffect(() => {
    if (foodSeen) {
      setGoneAt(null);
      return;
    }
    setGoneAt(Date.now());
    const t = window.setTimeout(() => rerender((n) => n + 1), CALORIE_PANEL_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [foodSeen]);
  const result = calorieView(line, v.latestId ? { id: v.latestId, objectLabel: v.latestLabel } : null);
  const anchor = boxCenter(v.box, v.srcW > 0 ? { w: v.srcW, h: v.srcH } : null, size);
  if (caloriePanelHidden(goneAt, Date.now())) return null;
  return <FoodStatusPanel result={result} anchor={anchor} />;
}

function SceneNoteView({ line }: PluginViewProps) {
  const text = line ? sanitizeAppText(line.text) : '';
  if (!text) return null;
  return (
    <div className="fm-scenenote">
      <span className="fm-scenenote__card fm-glass fm-glass--panel">{text}</span>
    </div>
  );
}

/** 변조 시험: 앱이 규칙을 어기려다 framelet에 막힌 횟수(위반 기록)와 마지막 사유. 사유 속 앱 문자열은 logReason이 거른다. */
function TamperView({ pluginId }: PluginViewProps) {
  const v = useLensStore(
    useShallow((s) => {
      let n = 0;
      let last: (typeof s.logs)[number] | null = null;
      for (const e of s.logs) {
        if (e.pluginId !== pluginId || e.kind !== 'violation') continue;
        n++;
        last = e;
      }
      return { n, reason: last ? logReason(last) : '' };
    }),
  );
  return (
    <div className="fm-scenenote">
      <span className="fm-scenenote__card fm-glass fm-glass--panel" role="status">
        {v.n === 0 ? '변조 시험 · 아직 막은 것 없음' : `변조 시험 · ${v.n}번 막음 · ${v.reason}`}
      </span>
    </div>
  );
}
