import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { Button } from '../ui/components';
import {
  OBS_INPUT_NAME,
  addOverlayToObs,
  connectObs,
  disconnectObs,
  ensureObsAutoConnect,
  loadObsPrefs,
  setObsRemember,
  useObsBridge,
} from './obsBridge';
import type { AddOverlayResult } from './obsBridge';
import { OBS_STATUS, ObsError, isObsError } from './obsWebsocket';
import type { ObsErrorKind } from './obsWebsocket';
import './obsConnect.css';

/**
 * Khối "Gửi thẳng vào OBS" trong hộp thoại OBS (ObsLinkModal): bật obs-websocket trong OBS, dán mật khẩu
 * một lần ("Nhớ trên máy này"), bấm Kết nối → "Thêm overlay vào OBS" tạo / cập nhật Browser Source
 * "DF Harmonica Tiles" cỡ canvas tại 0,0 (bố cục cả canvas tự khớp bảng phím game — không kéo, không
 * căn) và Player relay trạng thái sang đó (obsBridge.ts). Kết nối sống ở module, không theo hộp thoại:
 * đóng hộp thoại vẫn giữ kết nối.
 */

const ERROR_KEY: Readonly<Record<ObsErrorKind, StringKey>> = {
  unreachable: 'obsws.error.unreachable',
  blocked: 'obsws.error.blocked',
  insecureHost: 'obsws.error.insecureHost',
  invalidHost: 'obsws.error.invalidHost',
  authRequired: 'obsws.error.authRequired',
  authFailed: 'obsws.error.authFailed',
  insecureContext: 'obsws.error.insecureContext',
  timeout: 'obsws.error.timeout',
  unsupported: 'obsws.error.unsupported',
  protocol: 'obsws.error.protocol',
  closed: 'obsws.error.closed',
  notConnected: 'obsws.error.notConnected',
  request: 'obsws.error.request',
  requestTimeout: 'obsws.error.requestTimeout',
  nameTaken: 'obsws.error.nameTaken',
};

/** Câu hướng dẫn cho một lỗi OBS (`address` = "host:port" của lần kết nối). */
export function obsErrorText(t: TFunction, err: ObsError, address: string): string {
  if (err.kind === 'request' && err.code === OBS_STATUS.NotReady) return t('obsws.error.notReady');
  return t(ERROR_KEY[err.kind], {
    address,
    request: err.requestType ?? '?',
    code: err.code ?? '?',
    comment: err.comment ?? '',
    name: OBS_INPUT_NAME,
  }).trim();
}

interface Added {
  result: AddOverlayResult;
  /** Link đã gửi vào OBS (khác link hiện tại = tùy chọn vừa đổi, cần cập nhật). */
  url: string;
}

export function ObsConnectPanel({ overlayUrl }: { overlayUrl: string }) {
  const t = useT();
  const id = useId();
  const obs = useObsBridge();
  const [prefs] = useState(loadObsPrefs);
  const [password, setPassword] = useState(prefs.password);
  const [remember, setRemember] = useState(prefs.remember);
  const [host, setHost] = useState(prefs.host);
  const [port, setPort] = useState(String(prefs.port));
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [addError, setAddError] = useState<ObsError | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Nút vừa bấm biến mất (form ẩn khi đã kết nối / hiện lại khi ngắt) → chuyển focus sang nút kế tiếp. */
  const focusNext = useRef<'add' | 'connect' | null>(null);

  // Lần đầu khối mở ra: tự kết nối bằng mật khẩu đã nhớ (nếu Player chưa làm việc đó).
  useEffect(() => {
    ensureObsAutoConnect();
  }, []);

  const connected = obs.status === 'connected';
  const manualConnecting = obs.status === 'connecting' && !obs.auto;
  const address = `${obs.host}:${obs.port}`;

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    if (target === 'add') {
      if (obs.status === 'connecting') return;
      focusNext.current = null;
      // Kết nối hỏng: nút Kết nối vẫn còn (giữ focus ở đó).
      if (!connected) return;
    } else {
      if (connected) return;
      focusNext.current = null;
    }
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-obs-focus="${target}"]`)?.focus();
  }, [connected, obs.status]);

  const onConnect = (e: FormEvent) => {
    e.preventDefault();
    setAddError(null);
    focusNext.current = 'add';
    void connectObs({ host, port: Number(port), password, remember });
  };

  const onDisconnect = () => {
    focusNext.current = 'connect';
    setAdded(null);
    setAddError(null);
    disconnectObs();
  };

  const onRemember = (v: boolean) => {
    setRemember(v);
    setObsRemember(v);
  };

  const onAdd = async () => {
    setAdding(true);
    setAddError(null);
    const url = overlayUrl;
    try {
      const result = await addOverlayToObs(url);
      setAdded({ result, url });
    } catch (e) {
      setAdded(null);
      setAddError(isObsError(e) ? e : new ObsError('protocol'));
    } finally {
      setAdding(false);
    }
  };

  let status: { tone: 'ok' | 'warn' | 'info'; text: string } | null = null;
  if (obs.status === 'connecting') {
    status = {
      tone: 'info',
      text: t(obs.auto ? 'obsws.status.retrying' : 'obsws.status.connecting', { address }),
    };
  } else if (connected) {
    status = {
      tone: 'ok',
      text: obs.obsVersion
        ? t('obsws.status.connected', { version: obs.obsVersion })
        : t('obsws.status.connectedWs', { version: obs.wsVersion ?? '5' }),
    };
  } else if (obs.status === 'error' && obs.error) {
    status = { tone: 'warn', text: obsErrorText(t, obs.error, address) };
  }

  const stale = added !== null && added.url !== overlayUrl;
  const addLabel = adding ? t('obsws.adding') : added ? t('obsws.update') : t('obsws.add');
  const r = added?.result;

  return (
    <div className="obs-connect" ref={rootRef}>
      {!connected ? (
        <>
          <ol className="obs-connect-steps">
            <li>{t('obsws.step1')}</li>
            <li>{t('obsws.step2')}</li>
            <li>{t('obsws.step3')}</li>
          </ol>
          <form className="obs-connect-form" onSubmit={onConnect} noValidate>
            <div className="field obs-connect-password">
              <label htmlFor={`${id}-pw`}>{t('obsws.password')}</label>
              <input
                id={`${id}-pw`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                aria-describedby={`${id}-pw-hint`}
              />
              <p id={`${id}-pw-hint`} className="field-hint">
                {t('obsws.passwordHint')}
              </p>
            </div>
            <div className="obs-connect-remember">
              <input
                id={`${id}-remember`}
                type="checkbox"
                checked={remember}
                onChange={(e) => onRemember(e.currentTarget.checked)}
                aria-describedby={`${id}-remember-hint`}
              />
              <label htmlFor={`${id}-remember`}>{t('obsws.remember')}</label>
              <p id={`${id}-remember-hint`} className="field-hint">
                {t('obsws.rememberHint')}
              </p>
            </div>
            <details className="obs-connect-advanced">
              <summary>{t('obsws.advanced')}</summary>
              <div className="obs-connect-address">
                <div className="field obs-connect-host">
                  <label htmlFor={`${id}-host`}>{t('obsws.host')}</label>
                  <input
                    id={`${id}-host`}
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={host}
                    onChange={(e) => setHost(e.currentTarget.value)}
                    aria-describedby={`${id}-adv-hint`}
                  />
                </div>
                <div className="field obs-connect-port">
                  <label htmlFor={`${id}-port`}>{t('obsws.port')}</label>
                  <input
                    id={`${id}-port`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    step={1}
                    value={port}
                    onChange={(e) => setPort(e.currentTarget.value)}
                    aria-describedby={`${id}-adv-hint`}
                  />
                </div>
              </div>
              <p id={`${id}-adv-hint`} className="field-hint">
                {t('obsws.advancedHint')}
              </p>
            </details>
            <div className="row obs-connect-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={manualConnecting}
                data-obs-focus="connect"
              >
                {manualConnecting ? t('obsws.connecting') : t('obsws.connect')}
              </Button>
              {obs.status === 'connecting' && obs.auto ? (
                <Button onClick={onDisconnect}>{t('obsws.disconnect')}</Button>
              ) : null}
            </div>
          </form>
        </>
      ) : null}

      <div className="obs-connect-live" aria-live="polite">
        {status ? (
          <p
            className={`obs-connect-msg obs-connect-msg-${status.tone}`}
            data-obs-status={obs.status}
          >
            {status.text}
          </p>
        ) : null}
      </div>

      <div className="row obs-connect-actions">
        <Button
          variant={connected ? 'primary' : 'secondary'}
          disabled={!connected || adding}
          onClick={() => void onAdd()}
          data-obs-focus="add"
        >
          {addLabel}
        </Button>
        {connected ? <Button onClick={onDisconnect}>{t('obsws.disconnect')}</Button> : null}
      </div>

      <div className="obs-connect-live" aria-live="polite">
        {addError ? (
          <p className="obs-connect-msg obs-connect-msg-warn">
            {obsErrorText(t, addError, address)}
          </p>
        ) : r && connected ? (
          <p className="obs-connect-msg obs-connect-msg-ok">
            {t(r.action === 'created' ? 'obsws.result.created' : 'obsws.result.updated', {
              name: r.inputName,
              scene: r.sceneName,
              w: r.width,
              h: r.height,
            })}
          </p>
        ) : null}
        {stale && connected && !addError ? (
          <p className="obs-connect-msg obs-connect-msg-info">{t('obsws.result.stale')}</p>
        ) : null}
      </div>

      <p className="field-hint obs-connect-note">{t('obsws.note')}</p>
    </div>
  );
}
