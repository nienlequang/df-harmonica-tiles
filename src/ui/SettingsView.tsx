import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { unlockAudioInGesture } from '../audio/gestureUnlock';
import { baseMidi, DEFAULT_BASE_OCTAVE, midiName, playableRange } from '../core/keys';
import type { KeyChoice } from '../core/keys';
import { DevNotesLink } from '../dev/DevNotesLink';
import type { Lang, StringKey } from '../i18n/strings';
import { tNow, useT } from '../i18n/useT';
import { mapMidiNote, midiMapOptionsFromSettings } from '../midi/mapping';
import type { MidiInputInfo } from '../midi/types';
import { getMidiInputManager, isWebMidiSupported } from '../midi/webmidi';
import type { MidiEnableResult } from '../midi/webmidi';
import { Button, Modal, Select, Slider, Toggle } from './components';
import type { SelectOption } from './components';
import { MelodyConfirmDialog, useMelodyToggle } from './MelodyConfirm';
import { modifierLabels, useModifierLabels } from './modLabels';
import type { ModifierLabels } from './modLabels';
import { LABEL_OVERRIDE_MAX, useSettings } from './settings';
import type {
  ControlScheme,
  MobileSemitone,
  ModifierLabelOverrides,
  PracticeMode,
  SubLabel,
  Theme,
  Timbre,
} from './settings';
import { toast } from './toast';
import './settings.css';

const BASE_OCTAVES = [2, 3, 4, 5, 6] as const;
const CONTROL_SCHEMES: readonly ControlScheme[] = ['pc', 'mobile'];
const SCHEME_LABEL: Readonly<Record<ControlScheme, StringKey>> = {
  pc: 'settings.controlScheme.pc',
  mobile: 'settings.controlScheme.mobile',
};
const SCHEME_HINT: Readonly<Record<ControlScheme, StringKey>> = {
  pc: 'settings.controlScheme.pcHint',
  mobile: 'settings.controlScheme.mobileHint',
};

const SEMITONE_MODES: readonly MobileSemitone[] = ['toggle', 'oneShot'];
const SEMITONE_LABEL: Readonly<Record<MobileSemitone, StringKey>> = {
  toggle: 'settings.mobileSemitone.toggle',
  oneShot: 'settings.mobileSemitone.oneShot',
};

type LabelSlot = keyof ModifierLabelOverrides;
const LABEL_SLOTS: readonly LabelSlot[] = ['left', 'right', 'natural', 'scroll'];
const LABEL_FIELD: Readonly<Record<LabelSlot, StringKey>> = {
  left: 'settings.labels.left',
  right: 'settings.labels.right',
  natural: 'settings.labels.natural',
  scroll: 'settings.labels.scroll',
};
const NO_OVERRIDES: Readonly<ModifierLabelOverrides> = {
  left: '',
  right: '',
  natural: '',
  scroll: '',
};

/** Phím MIDI tham chiếu cho gợi ý "Phím C4 trên đàn → Z". */
const MIDI_REFERENCE_NOTE = 60;

interface SettingsGroupProps {
  title: string;
  children: ReactNode;
  /** id cho tiêu đề card (để control trong card trỏ aria-labelledby tới); mặc định tự sinh. */
  headingId?: string;
  /**
   * Control xếp thành lưới ngang (2 cột khi card đủ rộng, 1 cột trên điện thoại) thay vì một cột dọc —
   * card thấp, không có khoảng trống lớn (góp ý 2026-10-16).
   */
  grid?: boolean;
  /** Huy hiệu cạnh tiêu đề (ngoài <h2> → không thành tên của vùng). */
  badges?: ReactNode;
}

function SettingsGroup({ title, children, headingId, grid = false, badges }: SettingsGroupProps) {
  const autoId = useId();
  const id = headingId ?? autoId;
  return (
    <section className="card settings-card" aria-labelledby={id}>
      <div className="settings-card-head">
        <h2 id={id} className="settings-card-title hud-section-title">
          {title}
        </h2>
        {badges}
      </div>
      <div className={grid ? 'settings-fields is-grid' : 'settings-fields'}>{children}</div>
    </section>
  );
}

/** Số có dấu: 0 → "0", 2 → "+2", -3 → "−3". */
export function signedNumber(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** Cách bấm trên harmonica theo tên gọi hiện tại: "Cúi Xuống + Nửa Cung + Z". */
export function describeKeyChoice(
  labels: Pick<ModifierLabels, 'left' | 'right' | 'scroll'>,
  c: KeyChoice,
): string {
  const parts: string[] = [];
  if (c.octave < 0) parts.push(labels.left);
  if (c.octave > 0) parts.push(labels.right);
  if (c.sharp) parts.push(labels.scroll);
  parts.push(c.key);
  return parts.join(' + ');
}

/**
 * Route #/settings: cài đặt persist localStorage (src/ui/settings.ts).
 *
 * Bố cục (góp ý 2026-10-16): hai cột cố định, card không nhảy cột khi nội dung đổi (vd. chọn Mobile mở
 * thêm mục Nửa Cung) — cột trái 01 Kiểu điều khiển · 02 Giao diện · 03 Phát bài · 04 Harmonica, cột phải
 * 05 Âm thanh · 06 Luyện tập · 07 MIDI (luôn cuối). Màn hẹp: hai cột xếp chồng → đúng thứ tự 01…07. Trong
 * card control xếp lưới ngang. Không có thẻ Phím tắt (cột trái màn chơi đã có danh sách), không có
 * Lookahead (chỉ chỉnh ở thanh điều khiển màn chơi). Âm thanh là một card thường (không giấu trong "Nâng
 * cao"), mặc định tắt hết; bật giai điệu vẫn qua hộp cảnh báo bản quyền.
 */
export function SettingsView() {
  const t = useT();
  const s = useSettings();
  const set = s.set;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const rangeHintId = useId();
  const delayHintId = useId();
  const floatDelayHintId = useId();

  const doReset = () => {
    useSettings.getState().reset();
    setConfirmOpen(false);
    // tNow: ngôn ngữ có thể vừa đổi về mặc định.
    toast(tNow('settings.resetDone'));
  };

  const themeOptions: SelectOption<Theme>[] = [
    { value: 'dark', label: t('settings.theme.dark') },
    { value: 'light', label: t('settings.theme.light') },
  ];
  const langOptions: SelectOption<Lang>[] = [
    { value: 'vi', label: t('settings.lang.vi') },
    { value: 'en', label: t('settings.lang.en') },
  ];
  const subLabelOptions: SelectOption<SubLabel>[] = [
    { value: 'solfege', label: t('settings.subLabel.solfege') },
    { value: 'number', label: t('settings.subLabel.number') },
    { value: 'none', label: t('settings.subLabel.none') },
  ];
  const octaveOptions: SelectOption<string>[] = BASE_OCTAVES.map((o) => {
    const label = t('settings.baseOctaveOption', { note: midiName(baseMidi(o)) });
    return {
      value: String(o),
      label: o === DEFAULT_BASE_OCTAVE ? t('settings.baseOctaveDefault', { label }) : label,
    };
  });

  const range = playableRange(s.baseOctave);
  const scaleText = (v: number) => t('settings.tileScaleValue', { v: v.toFixed(2) });
  const delayText = (v: number) =>
    v === 0 ? t('settings.startDelayOff') : t('settings.startDelayValue', { n: v });

  return (
    <div className="settings-view hud-numbered">
      <header className="settings-header">
        <h1>{t('common.settings')}</h1>
        <p className="muted">{t('settings.intro')}</p>
      </header>

      <div className="settings-grid">
        <div className="settings-col">
          <ControlSettings />

          <SettingsGroup title={t('settings.group.appearance')} grid>
            <Select<Theme>
              label={t('settings.theme')}
              value={s.theme}
              options={themeOptions}
              onChange={(theme) => set({ theme })}
            />
            <Select<Lang>
              label={t('common.language')}
              value={s.language}
              options={langOptions}
              onChange={(language) => set({ language })}
            />
            <Slider
              label={t('settings.tileScale')}
              value={s.tileScale}
              min={0.75}
              max={1.5}
              step={0.05}
              format={scaleText}
              aria-valuetext={scaleText(s.tileScale)}
              onChange={(tileScale) => set({ tileScale })}
            />
            <Select<SubLabel>
              label={t('settings.subLabel')}
              value={s.subLabel}
              options={subLabelOptions}
              onChange={(subLabel) => set({ subLabel })}
            />
          </SettingsGroup>

          {/* Đếm vào + đếm ngược chỉ chỉnh ở đây (không còn trên thanh điều khiển màn chơi). Đếm vào chạy bằng
              hình nên nằm ở đây, không nằm trong card Âm thanh. */}
          <SettingsGroup title={t('settings.group.playback')} grid>
            <Toggle
              label={t('settings.countIn')}
              checked={s.countIn}
              hint={t('settings.countInHint')}
              onChange={(countIn) => set({ countIn })}
            />
            <div className="settings-field-group">
              <Slider
                label={t('settings.startDelay')}
                value={s.startDelaySec}
                min={0}
                max={10}
                step={1}
                format={delayText}
                aria-valuetext={delayText(s.startDelaySec)}
                aria-describedby={`${delayHintId} ${floatDelayHintId}`}
                onChange={(startDelaySec) => set({ startDelaySec })}
              />
              <p id={delayHintId} className="field-hint">
                {t('settings.startDelayHint')}
              </p>
              {/* Vòng R7: Cửa sổ nổi + trang mini đếm tối thiểu 3 s (pip/pipPrefs.ts floatingCountdownSec). */}
              <p id={floatDelayHintId} className="field-hint">
                {t('settings.startDelayFloatingHint')}
              </p>
            </div>
          </SettingsGroup>

          <SettingsGroup title={t('settings.group.harmonica')} grid>
            <div className="settings-field-group">
              <Select<string>
                label={t('settings.baseOctave')}
                value={String(s.baseOctave)}
                options={octaveOptions}
                aria-describedby={rangeHintId}
                onChange={(v) => set({ baseOctave: Number(v) })}
              />
              <p id={rangeHintId} className="field-hint">
                {t('settings.range', { min: midiName(range.min), max: midiName(range.max) })}
              </p>
            </div>
          </SettingsGroup>
        </div>

        <div className="settings-col">
          <SoundSettings />
          <PracticeSettings />
          {/* MIDI luôn là card cuối (góp ý 2026-10-16). */}
          <MidiSettings />
        </div>
      </div>

      <footer className="settings-footer">
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          {t('settings.reset')}
        </Button>
      </footer>
      {/* Tài liệu cho người phát triển: cố ý chỉ là link nhỏ, mờ ở cuối trang (vòng 7, R7-8). */}
      <DevNotesLink />

      <Modal
        open={confirmOpen}
        title={t('settings.resetTitle')}
        onClose={closeConfirm}
        footer={
          <>
            {/* Hộp xác nhận: focus mặc định vào lựa chọn an toàn. */}
            <Button variant="ghost" onClick={closeConfirm} data-autofocus>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={doReset}>
              {t('common.reset')}
            </Button>
          </>
        }
      >
        <p>{t('settings.resetBody')}</p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kiểu điều khiển + tên gọi nút
// ---------------------------------------------------------------------------

interface RadioOptionProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
}

/** Một lựa chọn radio dạng thẻ: cả thẻ bấm được; tên truy cập = dòng chính, hint đọc kèm. */
function RadioOption({ name, checked, onSelect, label, hint }: RadioOptionProps) {
  const labelId = useId();
  const hintId = useId();
  return (
    <label className="settings-radio">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
      />
      <span id={labelId} className="settings-radio-label">
        {label}
      </span>
      {hint ? (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function ControlSettings() {
  const t = useT();
  const scheme = useSettings((s) => s.controlScheme);
  const semitone = useSettings((s) => s.mobileSemitone);
  const set = useSettings((s) => s.set);
  const labels = useModifierLabels();
  const headingId = useId();
  const schemeName = useId();
  const semitoneName = useId();
  const schemeHintId = useId();
  const semitoneHintId = useId();

  return (
    <SettingsGroup title={t('settings.group.control')} headingId={headingId}>
      <div className="settings-field-group">
        <div
          role="radiogroup"
          className="settings-radios"
          aria-labelledby={headingId}
          aria-describedby={schemeHintId}
        >
          {CONTROL_SCHEMES.map((v) => (
            <RadioOption
              key={v}
              name={schemeName}
              checked={scheme === v}
              onSelect={() => set({ controlScheme: v })}
              label={t(SCHEME_LABEL[v])}
              hint={t(SCHEME_HINT[v])}
            />
          ))}
        </div>
        <p id={schemeHintId} className="field-hint">
          {t('settings.controlScheme.hint')}
        </p>
      </div>
      {scheme === 'mobile' ? (
        <fieldset className="settings-fieldset" aria-describedby={semitoneHintId}>
          <legend>{t('settings.mobileSemitone', { mod: labels.scroll })}</legend>
          <div className="settings-radios">
            {SEMITONE_MODES.map((v) => (
              <RadioOption
                key={v}
                name={semitoneName}
                checked={semitone === v}
                onSelect={() => set({ mobileSemitone: v })}
                label={t(SEMITONE_LABEL[v])}
              />
            ))}
          </div>
          <p id={semitoneHintId} className="field-hint settings-note">
            {t('settings.mobileSemitoneHint', { mod: labels.scroll })}
          </p>
        </fieldset>
      ) : null}
      <LabelOverrideSettings />
    </SettingsGroup>
  );
}

/** "Tên gọi nút": 4 ô, placeholder = tên mặc định theo ngôn ngữ, để trống = mặc định. */
function LabelOverrideSettings() {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const defaults = modifierLabels(lang, NO_OVERRIDES);
  const hintId = useId();
  return (
    <fieldset className="settings-fieldset" aria-describedby={hintId}>
      <legend>{t('settings.labels')}</legend>
      <p id={hintId} className="field-hint">
        {t('settings.labelsHint')}
      </p>
      <div className="settings-label-list">
        {LABEL_SLOTS.map((slot) => (
          <LabelOverrideField
            key={slot}
            slot={slot}
            label={t(LABEL_FIELD[slot], { name: defaults[slot] })}
            defaultName={defaults[slot]}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface LabelOverrideFieldProps {
  slot: LabelSlot;
  label: string;
  defaultName: string;
}

function LabelOverrideField({ slot, label, defaultName }: LabelOverrideFieldProps) {
  const t = useT();
  const stored = useSettings((s) => s.labelOverrides[slot]);
  // Bản nháp khi đang gõ: store trim mỗi lần set, hiện thẳng giá trị store sẽ nuốt dấu cách vừa gõ
  // ("Cúi " → "Cúi"). Rời ô (blur) thì hiện lại giá trị đã lưu.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const value = draft ?? stored;

  const save = (v: string) => {
    const st = useSettings.getState();
    st.set({ labelOverrides: { ...st.labelOverrides, [slot]: v } });
  };
  const resetToDefault = () => {
    setDraft(null);
    save('');
    // Nút sẽ bị tắt (đã là mặc định) → giữ focus ở ô nhập thay vì rơi về <body>.
    inputRef.current?.focus();
  };

  return (
    <div className="field settings-label-field">
      <label htmlFor={id}>{label}</label>
      <div className="settings-label-row">
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={value}
          placeholder={defaultName}
          maxLength={LABEL_OVERRIDE_MAX}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setDraft(v);
            save(v);
          }}
          onBlur={() => setDraft(null)}
        />
        <Button
          size="sm"
          disabled={value === ''}
          aria-label={t('settings.labels.resetAria', { name: defaultName })}
          onClick={resetToDefault}
        >
          {t('settings.labels.reset')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Âm thanh (mặc định TẮT hết, SPEC "Âm thanh mặc định TẮT") — card thường, góp ý 2026-10-16
// ---------------------------------------------------------------------------

function SoundSettings() {
  const t = useT();
  const audioEnabled = useSettings((s) => s.audioEnabled);
  const clickSound = useSettings((s) => s.clickSound);
  const timbre = useSettings((s) => s.timbre);
  const musicVolume = useSettings((s) => s.musicVolume);
  const clickVolume = useSettings((s) => s.clickVolume);
  const metronome = useSettings((s) => s.metronome);
  const practiceFeedback = useSettings((s) => s.practiceFeedback);
  const set = useSettings((s) => s.set);
  // Bật giai điệu phải qua hộp cảnh báo bản quyền; tắt thì không cần hỏi. Logic + hộp dùng chung với nút
  // loa trên thanh điều khiển màn chơi (src/ui/MelodyConfirm.tsx).
  const melody = useMelodyToggle();
  const melodyId = useId();
  const clickId = useId();
  const practiceId = useId();
  const synthId = useId();
  const synthHintId = useId();
  const clickOffHintId = useId();

  const timbreOptions: SelectOption<Timbre>[] = [
    { value: 'harmonica', label: t('settings.timbre.harmonica') },
    { value: 'sine', label: t('settings.timbre.sine') },
  ];
  const percentText = (v: number) => t('settings.percent', { n: v });
  const musicPct = Math.round(musicVolume * 100);
  const clickPct = Math.round(clickVolume * 100);
  const clickOff = !clickSound;

  // Huy hiệu cạnh tiêu đề: giai điệu đang bật = đỏ (nguy cơ bản quyền), tiếng click = thường.
  const badges =
    audioEnabled || clickSound ? (
      <span className="settings-badges">
        {audioEnabled ? (
          <span className="badge settings-badge-melody">{t('settings.soundMelodyOn')}</span>
        ) : null}
        {clickSound ? <span className="badge">{t('settings.soundClickOn')}</span> : null}
      </span>
    ) : null;

  return (
    <SettingsGroup title={t('settings.group.sound')} badges={badges}>
      <p className="field-hint">{t('settings.soundIntro')}</p>
      <div className="settings-subgrid">
        <div className="settings-subcol">
          <section className="settings-subgroup" aria-labelledby={melodyId}>
            <h3 id={melodyId} className="settings-subgroup-title">
              {t('settings.sound.melody')}
            </h3>
            <div className="settings-fields">
              <Toggle
                label={t('settings.audioEnabled')}
                checked={audioEnabled}
                hint={t('settings.audioHint')}
                onChange={melody.request}
              />
            </div>
          </section>

          <section className="settings-subgroup" aria-labelledby={clickId}>
            <h3 id={clickId} className="settings-subgroup-title">
              {t('settings.sound.click')}
            </h3>
            <div className="settings-fields">
              <Toggle
                label={t('settings.clickSound')}
                checked={clickSound}
                hint={t('settings.clickSoundHint')}
                onChange={(v) => {
                  set({ clickSound: v });
                  // Bật trong cú bấm: mở khóa AudioContext ngay để lần Phát đầu đã có tiếng (D-423).
                  if (v) unlockAudioInGesture();
                }}
              />
              <Toggle
                label={t('settings.metronome')}
                checked={metronome}
                disabled={clickOff}
                className={clickOff ? 'is-disabled' : undefined}
                aria-describedby={clickOff ? clickOffHintId : undefined}
                onChange={(v) => set({ metronome: v })}
              />
              <Slider
                label={t('settings.clickVolume')}
                value={clickPct}
                min={0}
                max={100}
                step={5}
                format={percentText}
                disabled={clickOff}
                className={clickOff ? 'is-disabled' : undefined}
                aria-valuetext={percentText(clickPct)}
                aria-describedby={clickOff ? clickOffHintId : undefined}
                onChange={(v) => set({ clickVolume: v / 100 })}
              />
              {clickOff ? (
                <p id={clickOffHintId} className="field-hint">
                  {t('settings.clickOffHint')}
                </p>
              ) : null}
            </div>
          </section>
        </div>
        <div className="settings-subcol">
          {/* Âm sắc + âm lượng synth dùng chung cho giai điệu, tiếng phản hồi (practice / màn thu / Thu melody)
              và "Nghe thử" (D-136 phát cả khi giai điệu tắt) → luôn chỉnh được; tự chúng không phát tiếng. */}
          <section className="settings-subgroup" aria-labelledby={synthId}>
            <h3 id={synthId} className="settings-subgroup-title">
              {t('settings.sound.synth')}
            </h3>
            <div className="settings-fields">
              <Select<Timbre>
                label={t('settings.timbre')}
                value={timbre}
                options={timbreOptions}
                aria-describedby={synthHintId}
                onChange={(v) => set({ timbre: v })}
              />
              <Slider
                label={t('settings.musicVolume')}
                value={musicPct}
                min={0}
                max={100}
                step={5}
                format={percentText}
                aria-valuetext={percentText(musicPct)}
                aria-describedby={synthHintId}
                onChange={(v) => set({ musicVolume: v / 100 })}
              />
              <p id={synthHintId} className="field-hint">
                {t('settings.synthHint')}
              </p>
            </div>
          </section>

          <section className="settings-subgroup" aria-labelledby={practiceId}>
            <h3 id={practiceId} className="settings-subgroup-title">
              {t('settings.sound.practice')}
            </h3>
            <div className="settings-fields">
              <Toggle
                label={t('settings.practiceFeedback')}
                checked={practiceFeedback}
                hint={t('settings.practiceFeedbackHint')}
                onChange={(v) => {
                  set({ practiceFeedback: v });
                  if (v) unlockAudioInGesture();
                }}
              />
            </div>
          </section>
        </div>
      </div>

      <MelodyConfirmDialog
        open={melody.confirmOpen}
        onCancel={melody.cancel}
        onConfirm={melody.confirm}
      />
    </SettingsGroup>
  );
}

// ---------------------------------------------------------------------------
// Luyện tập
// ---------------------------------------------------------------------------

function PracticeSettings() {
  const t = useT();
  const mode = useSettings((s) => s.practiceMode);
  const set = useSettings((s) => s.set);
  const labels = useModifierLabels();

  const modeOptions: SelectOption<PracticeMode>[] = [
    { value: 'wait', label: t('settings.practiceMode.wait') },
    { value: 'score', label: t('settings.practiceMode.score') },
  ];

  return (
    <SettingsGroup title={t('settings.group.practice')} grid>
      <Select<PracticeMode>
        label={t('settings.practiceMode')}
        value={mode}
        options={modeOptions}
        onChange={(practiceMode) => set({ practiceMode })}
      />
      <div className="settings-notes">
        <p className="field-hint">
          {t('settings.practiceMouseHint', {
            left: labels.left,
            right: labels.right,
            scroll: labels.scroll,
          })}
        </p>
        <p className="field-hint">{t('practice.focusNote')}</p>
        {/* Kiểu Mobile: luyện tập chỉ bằng chạm / click bàn nút trên màn hình (góp ý 2026-10-15). */}
        <p className="field-hint">{t('settings.practiceTouchHint')}</p>
      </div>
    </SettingsGroup>
  );
}

// ---------------------------------------------------------------------------
// MIDI
// ---------------------------------------------------------------------------

type MidiAccessState = 'idle' | 'requesting' | MidiEnableResult;

/** Card MIDI: trình duyệt không có Web MIDI → chỉ một dòng giải thích. */
function MidiSettings() {
  const t = useT();
  const [supported] = useState(() => isWebMidiSupported());
  if (!supported) {
    return (
      <SettingsGroup title={t('settings.group.midi')}>
        <p className="field-hint">{t('settings.midi.unsupported')}</p>
      </SettingsGroup>
    );
  }
  return <MidiSettingsBody />;
}

function MidiSettingsBody() {
  const t = useT();
  const enabled = useSettings((s) => s.midiEnabled);
  const inputId = useSettings((s) => s.midiInputId);
  const semitones = useSettings((s) => s.midiTransposeSemitones);
  const octaves = useSettings((s) => s.midiTransposeOctaves);
  const pitchClassOnly = useSettings((s) => s.midiPitchClassOnly);
  const baseOctave = useSettings((s) => s.baseOctave);
  const set = useSettings((s) => s.set);
  const labels = useModifierLabels();
  const [access, setAccess] = useState<MidiAccessState>(() =>
    getMidiInputManager().enabled ? 'ok' : 'idle',
  );
  const [inputs, setInputs] = useState<MidiInputInfo[]>(() => getMidiInputManager().inputs());
  const [connected, setConnected] = useState(() => getMidiInputManager().connected);
  const [blink, setBlink] = useState(0);
  const alive = useRef(true);
  const deviceHintId = useId();
  const mapHintId = useId();

  const refresh = useCallback(() => {
    const mgr = getMidiInputManager();
    setInputs(mgr.inputs());
    setConnected(mgr.connected);
  }, []);

  /** Xin quyền (lần đầu trình duyệt hỏi). Bị từ chối / không hỗ trợ → tắt lại MIDI, báo lý do. */
  const requestAccess = useCallback(async () => {
    const mgr = getMidiInputManager();
    setAccess('requesting');
    const res = await mgr.enable();
    if (!alive.current) return;
    setAccess(res);
    if (res === 'ok') {
      const id = useSettings.getState().midiInputId;
      if (id !== null && mgr.selectedId !== id) mgr.select(id);
      refresh();
    } else {
      useSettings.getState().set({ midiEnabled: false });
    }
  }, [refresh]);

  useEffect(() => {
    alive.current = true;
    const mgr = getMidiInputManager();
    const offDevices = mgr.onDevicesChange(refresh);
    const offActivity = mgr.onActivity(() => setBlink((n) => n + 1));
    // Đã bật từ trước (vd. lần mở trước) → lấy lại danh sách thiết bị.
    if (useSettings.getState().midiEnabled && !mgr.enabled) void requestAccess();
    return () => {
      alive.current = false;
      offDevices();
      offActivity();
    };
  }, [refresh, requestAccess]);

  const onToggle = (on: boolean) => {
    set({ midiEnabled: on });
    if (on) {
      void requestAccess();
    } else {
      getMidiInputManager().select(null);
      refresh();
    }
  };

  const onDevice = (value: string) => {
    const id = value === '' ? null : value;
    set({ midiInputId: id });
    getMidiInputManager().select(id);
    refresh();
  };

  const deviceOptions: SelectOption<string>[] = [
    { value: '', label: t('settings.midi.noDevice') },
    ...inputs.map((i) => ({
      value: i.id,
      label: i.state === 'connected' ? i.name : t('settings.midi.missingDevice', { name: i.name }),
    })),
  ];
  if (inputId !== null && !inputs.some((i) => i.id === inputId)) {
    deviceOptions.push({
      value: inputId,
      label: t('settings.midi.missingDevice', { name: inputId }),
    });
  }
  const ready = enabled && access === 'ok';
  const status =
    inputId === null
      ? t('settings.midi.status.none')
      : connected
        ? t('settings.midi.status.connected')
        : t('settings.midi.status.disconnected');

  const mapOpts = midiMapOptionsFromSettings({
    baseOctave,
    midiTransposeSemitones: semitones,
    midiTransposeOctaves: octaves,
  });
  const choice = mapMidiNote(MIDI_REFERENCE_NOTE, mapOpts);
  const refName = midiName(MIDI_REFERENCE_NOTE);
  const range = playableRange(baseOctave);
  const offset = semitones + 12 * octaves;
  const mapHint = choice
    ? t('settings.midi.mapHint', { note: refName, key: describeKeyChoice(labels, choice) })
    : t('settings.midi.mapOut', { note: refName });

  return (
    <SettingsGroup title={t('settings.group.midi')} grid>
      <Toggle
        label={t('settings.midi.enable')}
        checked={enabled}
        hint={t('settings.midi.enableHint')}
        onChange={onToggle}
      />
      <Toggle
        label={t('settings.midi.pitchClass')}
        checked={pitchClassOnly}
        hint={t('settings.midi.pitchClassHint')}
        onChange={(midiPitchClassOnly) => set({ midiPitchClassOnly })}
      />
      {access === 'requesting' ? (
        <p className="field-hint settings-span" role="status">
          {t('settings.midi.requesting')}
        </p>
      ) : null}
      {access === 'denied' || access === 'unsupported' ? (
        <p className="field-hint settings-error settings-span" role="alert">
          {access === 'denied' ? t('settings.midi.denied') : t('settings.midi.unsupported')}
        </p>
      ) : null}
      {ready ? (
        <div className="settings-field-group settings-span">
          <Select<string>
            label={t('settings.midi.device')}
            value={inputId ?? ''}
            options={deviceOptions}
            aria-describedby={deviceHintId}
            onChange={onDevice}
          />
          <p id={deviceHintId} className="field-hint midi-status" role="status">
            <span
              key={blink}
              className={blink > 0 ? 'midi-activity is-blink' : 'midi-activity'}
              data-connected={connected ? 'true' : 'false'}
              aria-hidden="true"
            />
            {status}
            {inputs.length === 0 ? ` ${t('settings.midi.noDevices')}` : ''}
          </p>
        </div>
      ) : null}
      <Slider
        label={t('settings.midi.semitones')}
        value={semitones}
        min={-11}
        max={11}
        step={1}
        format={signedNumber}
        aria-valuetext={t('settings.midi.semitonesValue', { n: signedNumber(semitones) })}
        aria-describedby={mapHintId}
        onChange={(midiTransposeSemitones) => set({ midiTransposeSemitones })}
      />
      <Slider
        label={t('settings.midi.octaves')}
        value={octaves}
        min={-3}
        max={3}
        step={1}
        format={signedNumber}
        aria-valuetext={t('settings.midi.octavesValue', { n: signedNumber(octaves) })}
        aria-describedby={mapHintId}
        onChange={(midiTransposeOctaves) => set({ midiTransposeOctaves })}
      />
      <p id={mapHintId} className="field-hint midi-map-hint settings-span">
        {mapHint}{' '}
        {t('settings.midi.keyboardRange', {
          min: midiName(range.min - offset),
          max: midiName(range.max - offset),
        })}
      </p>
    </SettingsGroup>
  );
}
