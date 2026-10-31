// 매니페스트 편집기(F11·F14, FR-042·043)와 플러그인 켜기·끄기. 데스크톱 오른쪽 "매니페스트" 탭.
// 검증은 core의 validateManifest, 적용은 스토어 applyManifest. 통과하면 B가 iframe을 다시 만들고(전환 공통 절차) 다음 전달부터 반영된다.
// 검증 실패는 아무것도 바꾸지 않으므로, 기존 값으로 계속 전달한다는 사실까지 말한다.
// purpose 같은 매니페스트 문자열은 플러그인 쪽 입력이므로 텍스트 노드로만 넣는다.

import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { validateManifest, type Manifest } from '../core/manifest';
import { useLensStore } from '../core/store';
import type { PluginStatus, VersionedManifest } from '../core/types';
import { josa, PLUGIN_NAME } from './labels';
import type { Tone } from './OrbStack';

const STATUS: Record<PluginStatus, [string, Tone]> = {
  loading: ['적용 중', 'hold'],
  ready: ['준비됨', 'safe'],
  stopped: ['멈춤', 'hold'],
  terminated: ['꺼짐', 'hold'],
};

function manifestJson(m: VersionedManifest): string {
  const { version: _version, ...rest } = m;
  const plain: Manifest = rest;
  return JSON.stringify(plain, null, 2);
}

export function ManifestPanel() {
  const ids = useLensStore(useShallow((s) => s.pluginOrder));
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked ?? ids[0] ?? null;
  return (
    <div className="fm-manifest">
      <ul className="fm-plugins">
        {ids.map((pid) => (
          <PluginRow key={pid} id={pid} picked={pid === id} onPick={setPicked} />
        ))}
      </ul>
      {id && <Editor key={id} id={id} />}
    </div>
  );
}

function PluginRow({ id, picked, onPick }: { id: string; picked: boolean; onPick(id: string): void }) {
  const p = useLensStore(
    useShallow((s) => {
      const x = s.plugins[id];
      return { kind: x?.kind, status: x?.status ?? 'terminated', enabled: x?.enabled ?? false, purpose: x?.manifest.purpose ?? '' };
    }),
  );
  const blocked = useLensStore((s) => s.logs.reduce((n, l) => n + (l.kind === 'violation' && l.pluginId === id ? 1 : 0), 0));
  const setEnabled = useLensStore((s) => s.setPluginEnabled);
  const [label, tone] = STATUS[p.status];
  const name = p.kind ? PLUGIN_NAME[p.kind] : id;
  return (
    <li className="fm-plugin fm-glass" data-picked={picked} data-tone={blocked > 0 ? 'blocked' : tone}>
      <button type="button" className="fm-plugin__pick" onClick={() => onPick(id)} aria-pressed={picked}>
        <span className="fm-label">
          <span className="fm-dot" aria-hidden="true" />
          {name}
          {blocked > 0 && <span className="fm-tag fm-tag--blocked">차단 {blocked}</span>}
        </span>
        <span className="fm-readout">
          {label} · {p.purpose}
        </span>
      </button>
      <label className="fm-switch">
        <input type="checkbox" role="switch" checked={p.enabled} onChange={(e) => setEnabled(id, e.target.checked)} />
        <span aria-hidden="true" />
        <span className="fm-visually-hidden">{name} 켜기</span>
      </label>
    </li>
  );
}

function Editor({ id }: { id: string }) {
  const p = useLensStore(
    useShallow((s) => {
      const x = s.plugins[id]!;
      return { kind: x.kind, status: x.status, enabled: x.enabled, manifest: x.manifest, origins: x.allowedOrigins.join(' ') };
    }),
  );
  const applyManifest = useLensStore((s) => s.applyManifest);
  const setEnabled = useLensStore((s) => s.setPluginEnabled);
  const applied = manifestJson(p.manifest);
  const [text, setText] = useState(applied);
  const [dirty, setDirty] = useState(false);
  const [rejected, setRejected] = useState<string[] | null>(null);

  // 손대지 않은 동안에는 적용된 값을 따라간다(다른 곳에서 적용해도 낡은 글이 남지 않게).
  useEffect(() => {
    if (!dirty) setText(applied);
  }, [applied, dirty]);

  const check = validateManifest(text, id);
  const name = PLUGIN_NAME[p.kind];
  const [label, tone] = STATUS[p.status];

  const apply = () => {
    const r = applyManifest(id, text);
    if (r.ok) {
      setRejected(null);
      setDirty(false);
    } else setRejected(r.errors);
  };

  return (
    <section className="fm-editor" aria-label={`${name} 매니페스트`}>
      <div className="fm-loghead">
        <span className="fm-label">{name} 매니페스트</span>
        <span className="fm-capsule fm-capsule--sm fm-glass" data-tone={tone}>
          <span className="fm-dot" aria-hidden="true" />
          {label} · v{p.manifest.version}
        </span>
      </div>
      {p.status === 'stopped' && (
        <div className="fm-stopped fm-glass fm-glass--panel" data-tone="hold" role="alert">
          <span className="fm-thumb fm-thumb--empty" />
          <div>
            <div className="fm-label">{josa(name, '이/가')} 멈췄어요</div>
            <div className="fm-readout">새 권한으로 3초 안에 준비되지 않았습니다 · 이전 권한으로 돌아가지 않습니다</div>
          </div>
          <button type="button" className="fm-btn fm-btn--sm fm-btn--primary" onClick={() => setEnabled(id, true)}>
            다시 켜기
          </button>
        </div>
      )}
      <textarea
        className="fm-editor__text fm-glass"
        spellCheck={false}
        value={text}
        aria-invalid={!check.ok}
        aria-describedby={`fm-editor-msg-${id}`}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
          setRejected(null);
        }}
      />
      <div id={`fm-editor-msg-${id}`} className="fm-editor__msg" aria-live="polite">
        {rejected ? (
          <>
            <div className="fm-label fm-editor__bad" data-tone="blocked">
              <span className="fm-dot" aria-hidden="true" />
              적용하지 않았습니다
            </div>
            <ul className="fm-readout fm-editor__errors">
              {rejected.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <div className="fm-readout">기존 값(v{p.manifest.version})으로 계속 전달합니다</div>
          </>
        ) : !check.ok ? (
          <ul className="fm-readout fm-editor__errors">
            {check.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <div className="fm-readout">
            검증 통과 · 실제 허용 통신: {p.origins || '없음(통신 막힘)'}
            {dirty ? ' · 적용하면 iframe을 다시 만들고 다음 전달부터 반영' : ''}
          </div>
        )}
      </div>
      <div className="fm-editor__actions">
        {/* 검증에 실패해도 적용을 누를 수 있다: 거부되고 기존 값이 유지되는 것을 보여 주는 장면(FR-043) */}
        <button type="button" className="fm-btn fm-btn--primary" onClick={apply} data-invalid={!check.ok}>
          적용
        </button>
        <button
          type="button"
          className="fm-btn fm-glass"
          disabled={!dirty}
          onClick={() => {
            setText(applied);
            setDirty(false);
            setRejected(null);
          }}
        >
          되돌리기
        </button>
      </div>
    </section>
  );
}
