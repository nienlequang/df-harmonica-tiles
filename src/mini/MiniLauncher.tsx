/**
 * Nút "Cửa sổ nổi" của màn chơi trên điện thoại (kiểu Mobile, hoặc điện thoại không có Document PiP) —
 * `songId` = bài đang mở. Góp ý R7-6: hỏi trước "Điện thoại của bạn: Apple (iPhone / iPad) hay Android?"
 * (nhớ theo máy — src/pip/phonePref.ts; UA chỉ chọn sẵn nút), rồi:
 * - Android → hộp thoại "Cửa sổ mini / video nổi (thử nghiệm)": câu dẫn + 3 nhóm máy và bố cục nên dùng
 *   (`LauncherIntro`) + link "Mở trang mini"
 *   (`#/mini/<id>` — link thật nên copy / mở tab mới được; bấm link thì đóng hộp thoại, trình duyệt đổi hash).
 * - Apple → thẳng tới "Cửa sổ video nổi": dựng sẵn ngay (tiến độ %), rồi nút lớn "Mở video nổi" (một cú chạm —
 *   trình duyệt chỉ cho mở PiP trong cú chạm). Phần này tải lười (MiniLauncherVideo.tsx: videoPip + WebM chỉ
 *   nạp khi cần) và GIỮ NGUYÊN sau lần mở đầu: đóng hộp thoại không đóng khung video nổi đang mở.
 * Hai hộp thoại sau có dòng "Điện thoại: … · Đổi loại điện thoại" → hỏi lại.
 *
 * Bỏ trống `songId` = hộp thoại cũ có ô chọn bài (bài mẫu + bài của bạn; mặc định bài mở trang mini lần
 * trước), không hỏi loại điện thoại.
 */
import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { entryTitle, useSong, useSongList } from '../library/store';
import type { LibraryEntry } from '../library/store';
import { guessPhoneKind, usePhoneKind } from '../pip/phonePref';
import type { PhoneKind } from '../pip/phonePref';
import { Button, Modal } from '../ui/components';
import { href, paths } from '../ui/router';
import { readLastMiniSong } from './miniControl';
import './mini.css';
import './MiniLauncher.css';

/** Ba nhóm máy của hộp thoại Android (góp ý 2026-10-22): tên nhóm, vài dòng máy phổ biến, bố cục nên dùng. */
const LAUNCHER_DEVICES = [
  {
    title: 'mini.launcherDev.free.title',
    models: 'mini.launcherDev.free.models',
    use: 'mini.launcherDev.free',
  },
  {
    title: 'mini.launcherDev.samsungPhone.title',
    models: 'mini.launcherDev.samsungPhone.models',
    use: 'mini.launcherDev.samsungPhone',
  },
  {
    title: 'mini.launcherDev.other.title',
    models: 'mini.launcherDev.other.models',
    use: 'mini.launcherDev.other',
  },
] as const;

/** Đoạn mở đầu hộp thoại: câu dẫn + danh sách "loại máy (dòng máy): dùng bố cục nào". */
function LauncherIntro() {
  const t = useT();
  return (
    <>
      <p>{t('mini.launcherIntro')}</p>
      <ul className="mini-launch-devices">
        {LAUNCHER_DEVICES.map((d) => (
          <li key={d.title}>
            <strong>{t(d.title)}</strong>{' '}
            <span className="mini-launch-models">({t(d.models)})</span>: {t(d.use)}
          </li>
        ))}
      </ul>
    </>
  );
}

const SongVideoPip = lazy(() =>
  import('./MiniLauncherVideo').then((m) => ({ default: m.SongVideoPip })),
);

export interface MiniLauncherProps {
  open: boolean;
  onClose: () => void;
  /** Bài cố định (bài đang mở ở màn chơi) → hỏi Apple / Android; bỏ trống = ô chọn bài. */
  songId?: string;
}

export function MiniLauncher({ open, onClose, songId }: MiniLauncherProps) {
  return songId !== undefined ? (
    <PhoneLauncher open={open} onClose={onClose} songId={songId} />
  ) : (
    <PickSongLauncher open={open} onClose={onClose} />
  );
}

type Step = PhoneKind | 'choose';

/** Bài cố định: hỏi loại điện thoại (lần đầu / "Đổi loại điện thoại") → Android hoặc Apple. */
function PhoneLauncher({ open, onClose, songId }: Required<MiniLauncherProps>) {
  const t = useT();
  const [kind, setKind] = usePhoneKind();
  const [changing, setChanging] = useState(false);
  // Hộp thoại đóng → lần mở sau đi thẳng theo lựa chọn đã lưu.
  useEffect(() => {
    if (!open) setChanging(false);
  }, [open]);
  const step: Step = kind === null || changing ? 'choose' : kind;
  const appleOpen = open && step === 'apple';
  // Video nổi: mount ở lần mở đầu rồi giữ (phiên PiP + video đã dựng sống cùng màn chơi).
  const [videoMounted, setVideoMounted] = useState(false);
  useEffect(() => {
    if (appleOpen) setVideoMounted(true);
  }, [appleOpen]);

  const entry = useSong(songId);
  const title = entry ? entryTitle(entry) || t('common.untitled') : songId;
  const choose = (k: PhoneKind): void => {
    setKind(k);
    setChanging(false);
  };
  const change = (): void => setChanging(true);

  return (
    <>
      <Modal open={open && step === 'choose'} title={t('mini.phone.title')} onClose={onClose}>
        <PhoneChooser current={kind} onChoose={choose} />
      </Modal>
      <Modal open={open && step === 'android'} title={t('mini.launcherTitle')} onClose={onClose}>
        <FixedSongBody
          songId={songId}
          title={title}
          onClose={onClose}
          footer={<PhoneKindLine kind="android" onChange={change} />}
        />
      </Modal>
      {entry && (videoMounted || appleOpen) ? (
        <Suspense
          fallback={
            appleOpen ? (
              <Modal open title={t('mini.video.title')} onClose={onClose}>
                <p role="status">{t('common.loading')}</p>
              </Modal>
            ) : null
          }
        >
          <SongVideoPip
            entry={entry}
            open={appleOpen}
            onClose={onClose}
            footer={<PhoneKindLine kind="apple" onChange={change} />}
          />
        </Suspense>
      ) : null}
      {!entry ? (
        <Modal open={appleOpen} title={t('mini.video.title')} onClose={onClose}>
          <div className="mini-launch">
            <p className="mini-note" role="alert">
              {t('mini.songMissing', { id: songId })}
            </p>
            <PhoneKindLine kind="apple" onChange={change} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * "Điện thoại của bạn: Apple (iPhone / iPad) hay Android?" — hai nút lớn; nút chọn sẵn (lựa chọn đã lưu,
 * chưa có thì đoán theo UA) là nút chính và nhận focus khi hộp thoại mở.
 */
export function PhoneChooser({
  current,
  onChoose,
}: {
  current: PhoneKind | null;
  onChoose: (kind: PhoneKind) => void;
}) {
  const t = useT();
  const id = useId();
  const preselected = current ?? guessPhoneKind();
  const option = (k: PhoneKind) => {
    const pre = k === preselected;
    return (
      <Button
        key={k}
        variant={pre ? 'primary' : 'secondary'}
        size="lg"
        className="mini-phone-opt"
        data-kind={k}
        data-autofocus={pre ? '' : undefined}
        aria-labelledby={`${id}-${k}`}
        aria-describedby={`${id}-${k}-hint`}
        onClick={() => onChoose(k)}
      >
        <span id={`${id}-${k}`} className="mini-phone-opt-name">
          {t(k === 'apple' ? 'mini.phone.apple' : 'mini.phone.android')}
        </span>
        <span id={`${id}-${k}-hint`} className="mini-phone-opt-hint">
          {t(k === 'apple' ? 'mini.phone.appleHint' : 'mini.phone.androidHint')}
        </span>
      </Button>
    );
  };
  return (
    <div className="mini-launch mini-phone">
      <p id={`${id}-q`} className="mini-phone-question">
        {t('mini.phone.question')}
      </p>
      <div className="mini-phone-opts" role="group" aria-labelledby={`${id}-q`}>
        {option('apple')}
        {option('android')}
      </div>
      <p className="mini-launch-note">{t('mini.phone.remember')}</p>
    </div>
  );
}

/** "Điện thoại: Android · Đổi loại điện thoại" ở chân hộp thoại Android / Apple. */
export function PhoneKindLine({ kind, onChange }: { kind: PhoneKind; onChange: () => void }) {
  const t = useT();
  return (
    <p className="mini-phone-line" data-kind={kind}>
      <span>
        {t('mini.phone.current', {
          kind: t(kind === 'apple' ? 'mini.phone.kind.apple' : 'mini.phone.kind.android'),
        })}
      </span>
      <span aria-hidden="true"> · </span>
      <button type="button" className="mini-phone-change" onClick={onChange}>
        {t('mini.phone.change')}
      </button>
    </p>
  );
}

/** Bài cố định (Android): tên bài + giải thích + "Mở trang mini" (không ô chọn bài). */
function FixedSongBody({
  songId,
  title,
  onClose,
  footer,
}: {
  songId: string;
  title: string;
  onClose: () => void;
  footer: ReactNode;
}) {
  const t = useT();
  return (
    <div className="mini-launch">
      <LauncherIntro />
      <p className="mini-launch-song">{t('mini.launcherFor', { title })}</p>
      <p className="mini-launch-note">{t('mini.launcherNoFloat')}</p>
      <div className="mini-launch-actions">
        <a
          className="btn btn-primary btn-md mini-launch-open"
          href={href(paths.mini(songId))}
          onClick={onClose}
        >
          {t('mini.open')}
        </a>
      </div>
      {footer}
    </div>
  );
}

/** Không có bài cho sẵn: ô chọn bài + "Mở trang mini". */
function PickSongLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Modal open={open} title={t('mini.launcherTitle')} onClose={onClose}>
      {open ? <LauncherBody onClose={onClose} /> : null}
    </Modal>
  );
}

function LauncherBody({ onClose }: { onClose: () => void }) {
  const t = useT();
  const songs = useSongList();
  const seeds = useMemo(() => songs.filter((e) => e.seed), [songs]);
  const mine = useMemo(() => songs.filter((e) => !e.seed), [songs]);
  const pick = (id: string | null | undefined): string | null =>
    id && songs.some((e) => e.id === id) ? id : null;
  const [chosen, setChosen] = useState<string | null>(() => pick(readLastMiniSong()));
  const songId = pick(chosen) ?? songs[0]?.id ?? null;
  const selectId = useId();

  const option = (e: LibraryEntry) => (
    <option key={e.id} value={e.id}>
      {entryTitle(e) || t('common.untitled')}
    </option>
  );

  return (
    <div className="mini-launch">
      <LauncherIntro />
      {songs.length > 0 ? (
        <div className="field field-select">
          <label htmlFor={selectId}>{t('pip.song')}</label>
          <select
            id={selectId}
            value={songId ?? ''}
            onChange={(e) => setChosen(e.currentTarget.value)}
          >
            {seeds.length > 0 ? (
              <optgroup label={t('pip.groupSeeds')}>{seeds.map(option)}</optgroup>
            ) : null}
            {mine.length > 0 ? (
              <optgroup label={t('pip.groupUser')}>{mine.map(option)}</optgroup>
            ) : null}
          </select>
        </div>
      ) : (
        <p className="mini-note" role="status">
          {t('pip.noSongs')}
        </p>
      )}
      <p className="mini-launch-note">{t('mini.launcherNoFloat')}</p>
      <div className="mini-launch-actions">
        {songId !== null ? (
          <a
            className="btn btn-primary btn-md mini-launch-open"
            href={href(paths.mini(songId))}
            onClick={onClose}
          >
            {t('mini.open')}
          </a>
        ) : null}
      </div>
    </div>
  );
}
