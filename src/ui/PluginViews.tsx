// 플러그인 화면 자리(사용자 결정 2026-11-01, FR-034). framelet은 흰 틀과 사람 아이콘·숫자만 그리고, 앱 결과는
// 플러그인 종류마다 호스트가 고른 화면 하나가 그린다. 앱을 갈아 끼워도 흰 틀은 그대로다. core는 바꾸지 않는다.
// 칼로리 = 금빛 상태창(FoodStatusPanel)과 0단계 대상 박스 중심에서 나오는 금빛 연결선. 연결선은 이 화면만 쓴다.
// 장면 기록 = 작은 글자 카드. 변조 = 화면 없음(차단은 기록에 남는다).
// 앱 문자열은 sanitizeAppText를 거쳐 textContent로만 들어간다.

import type { ComponentType } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLensStore } from '../core/store';
import type { PluginKind, ResultLine } from '../core/types';
import { FoodStatusPanel } from './FoodStatusPanel';
import { boxCenter, type Size } from './geometry';
import { parseCalorieLine } from './labels';
import { sanitizeAppText } from './sanitize';

interface PluginViewProps {
  line: ResultLine;
  size: Size;
}

const PLUGIN_VIEW: Record<PluginKind, ComponentType<PluginViewProps> | null> = {
  calorie: CalorieView,
  hello: SceneNoteView,
  tamper: null,
};

/** 켜져 있는 앱마다 마지막 결과를 그 앱의 화면으로 그린다(pluginOrder 순). */
export function PluginViews({ size }: { size: Size }) {
  const results = useLensStore((s) => s.results);
  const plugins = useLensStore((s) => s.plugins);
  const order = useLensStore((s) => s.pluginOrder);
  return (
    <>
      {order.map((id) => {
        const p = plugins[id];
        const line = results[id];
        const View = p?.enabled && line ? PLUGIN_VIEW[p.kind] : null;
        return View && line ? <View key={id} line={line} size={size} /> : null;
      })}
    </>
  );
}

/** 결과 id는 deliveryId라 새 전달마다 닫았던 창이 다시 열린다. 고정표 결과는 FR-032대로 이름 뒤에 "(고정표)"를 붙인다. */
function CalorieView({ line, size }: PluginViewProps) {
  const v = useLensStore(
    useShallow((s) => ({
      box: s.liveObservation?.label === 'food' ? s.liveObservation.targetBox : null,
      srcW: s.session.input?.width ?? 0,
      srcH: s.session.input?.height ?? 0,
    })),
  );
  const parsed = parseCalorieLine(line.text);
  const name = sanitizeAppText(parsed.name);
  const anchor = boxCenter(v.box, v.srcW > 0 ? { w: v.srcW, h: v.srcH } : null, size);
  const result = name ? { id: line.deliveryId, name: line.source === 'fallback' ? `${name} (고정표)` : name, kcal: parsed.kcal } : null;
  return <FoodStatusPanel result={result} anchor={anchor} />;
}

function SceneNoteView({ line }: PluginViewProps) {
  const text = sanitizeAppText(line.text);
  if (!text) return null;
  return (
    <div className="fm-scenenote">
      <span className="fm-scenenote__card fm-glass fm-glass--panel">{text}</span>
    </div>
  );
}
