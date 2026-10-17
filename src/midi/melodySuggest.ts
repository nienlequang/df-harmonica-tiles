/**
 * Gợi ý track / bè mang giai điệu (góp ý 2026-10-15 C). Thuần TS.
 *
 * Tiêu chí chính là MẬT ĐỘ NỐT SO VỚI TEMPO, không phải "nhiều nốt nhất": số nốt mỗi beat (nốt đen)
 * trên cả bài — tương đương số nốt mỗi phút ÷ BPM — xấp xỉ 1 mới giống một câu hát / giai điệu. Thưa
 * quá (pad, nốt ngân, vài nốt điểm xuyết) hay dày quá (đàn hợp âm, rải hợp âm, trống) đều không phải.
 * Đo theo beat (tick / PPQ, hoặc beat của MusicXML) nên đổi tempo giữa bài không làm lệch mật độ.
 *
 * Điểm (càng thấp càng giống melody):
 * - |log2(mật độ)| — 1 nốt / beat = 0, gấp đôi hay một nửa = 1; ngoài dải hợp lý
 *   MELODY_DENSITY_BAND (0,4–2,5) bị phạt thêm (dốc hơn).
 * - phạt đa âm: (1 − tỉ lệ đơn âm) × 3 — hợp âm, hai bè chồng nhau.
 * - phạt âm vực trầm: cao độ trung bình dưới G3 (55) → +2 mỗi quãng tám (bass).
 * - thưởng nhỏ theo âm vực cao (±0,3 trong tầm C3–C6), để hai bè giống nhau thì bè trên thắng.
 * - tên gợi ý: "melody", "vocal", "voice", "lead", "solo", "giai điệu", "主旋律", "人声"… −0,75;
 *   tên kiểu đệm ("bass", "chord", "pad", "đệm", "伴奏"…) +0,5.
 * - bè có lời (MusicXML `sung`) −1.
 * - track trống / không có nốt: loại.
 * Không ứng viên nào nằm trong dải → vẫn chọn điểm thấp nhất (luôn có gợi ý nếu có track có cao độ).
 */

export interface MelodyCandidate {
  noteCount: number;
  /** Nốt / beat (nốt đen) trên khoảng thời gian cả bài (nốt đầu của mọi track → hết nốt cuối). */
  notesPerBeat: number;
  /** 0..1 — tỉ lệ thời lượng nốt không chồng lên nốt khác. */
  monophonicRatio: number;
  avgMidi: number;
  /** Tên track / bè (dò từ gợi ý). */
  name: string;
  /** Kênh 10 (MIDI) → loại. */
  isDrum?: boolean;
  /** Bè có lời trong MusicXML (bè hát). */
  sung?: boolean;
}

/** Dải mật độ (nốt / beat) hợp lý cho một giai điệu: 0,4–2,5 (đối xứng trong log2). */
export const MELODY_DENSITY_BAND = { min: 0.4, max: 2.5 } as const;

const BAND_LOG = Math.log2(MELODY_DENSITY_BAND.max);
/** Phạt thêm cho mỗi đơn vị log2 nằm ngoài dải. */
const OUT_OF_BAND_WEIGHT = 1.5;
const POLY_WEIGHT = 3;
/** Dưới cao độ trung bình này (G3) coi là âm vực bass. */
const BASS_PIVOT = 55;
const BASS_WEIGHT = 2;
const REGISTER_WEIGHT = 0.3;
const NAME_BONUS = 0.75;
const NAME_PENALTY = 0.5;
const SUNG_BONUS = 1;

/** Mật độ nốt / beat; khoảng thời gian < 1 beat tính như 1 beat (tránh chia cho 0). */
export function notesPerBeat(noteCount: number, spanBeats: number): number {
  if (!(noteCount > 0)) return 0;
  return noteCount / Math.max(Number.isFinite(spanBeats) ? spanBeats : 0, 1);
}

/** "≈ N nốt/phút" hiển thị cho người dùng: mật độ × BPM, làm tròn. */
export function notesPerMinute(density: number, bpm: number): number {
  return Math.round(density * bpm);
}

/** Từ (chữ Latin, tách theo ký tự không phải chữ / số) gợi ý melody. */
const MELODY_WORDS = new Set([
  'melody',
  'melodie',
  'mélodie',
  'melodia',
  'melodía',
  'vocal',
  'vocals',
  'voice',
  'vox',
  'voz',
  'lead',
  'solo',
  'sing',
  'singer',
  'singing',
  'chant',
  'canto',
  'hát',
  'giọng',
]);
/** Cụm (so khớp chuỗi con, đã viết thường) gợi ý melody — tiếng Việt nhiều chữ, CJK. */
const MELODY_PHRASES = [
  'giai điệu',
  'giai dieu',
  'main melody',
  '主旋律',
  '旋律',
  '人声',
  '人聲',
  '主唱',
  '歌声',
  'メロ',
  'ボーカル',
  'ヴォーカル',
  '멜로디',
  '보컬',
];
/** Từ gợi ý bè đệm. */
const ACCOMP_WORDS = new Set([
  'bass',
  'basso',
  'bajo',
  'contrabass',
  'chord',
  'chords',
  'pad',
  'pads',
  'accomp',
  'accompaniment',
  'comp',
  'backing',
  'harmony',
  'rhythm',
  'arp',
  'arpeggio',
  'drum',
  'drums',
  'perc',
  'percussion',
  'đệm',
]);
const ACCOMP_PHRASES = [
  'hợp âm',
  'hop am',
  '伴奏',
  '和弦',
  '和声',
  '贝斯',
  '低音',
  'ベース',
  '베이스',
];

/** +1 = tên gợi ý melody, −1 = tên kiểu bè đệm, 0 = không rõ. */
export function melodyNameHint(name: string): -1 | 0 | 1 {
  const lower = name.normalize('NFC').toLowerCase();
  if (lower.trim() === '') return 0;
  const words = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.some((w) => MELODY_WORDS.has(w)) || MELODY_PHRASES.some((p) => lower.includes(p))) {
    return 1;
  }
  if (words.some((w) => ACCOMP_WORDS.has(w)) || ACCOMP_PHRASES.some((p) => lower.includes(p))) {
    return -1;
  }
  return 0;
}

/** Điểm "không giống melody" (thấp = giống). Trống / không có nốt / mật độ 0 → Infinity. */
export function melodyCost(c: MelodyCandidate): number {
  if (c.isDrum === true || !(c.noteCount > 0) || !(c.notesPerBeat > 0)) return Infinity;
  const dist = Math.abs(Math.log2(c.notesPerBeat));
  let cost = dist + Math.max(0, dist - BAND_LOG) * OUT_OF_BAND_WEIGHT;
  const mono = Number.isFinite(c.monophonicRatio) ? Math.min(1, Math.max(0, c.monophonicRatio)) : 1;
  cost += (1 - mono) * POLY_WEIGHT;
  if (Number.isFinite(c.avgMidi)) {
    cost += (Math.max(0, BASS_PIVOT - c.avgMidi) / 12) * BASS_WEIGHT;
    const reg = Math.min(84, Math.max(48, c.avgMidi));
    cost -= ((reg - 66) / 18) * REGISTER_WEIGHT;
  }
  const hint = melodyNameHint(c.name);
  if (hint > 0) cost -= NAME_BONUS;
  else if (hint < 0) cost += NAME_PENALTY;
  if (c.sung === true) cost -= SUNG_BONUS;
  return cost;
}

/** true nếu mật độ nằm trong dải hợp lý của một giai điệu. */
export function densityInBand(density: number): boolean {
  return density >= MELODY_DENSITY_BAND.min - 1e-9 && density <= MELODY_DENSITY_BAND.max + 1e-9;
}

/**
 * Index ứng viên giống melody nhất (điểm thấp nhất; hòa → ứng viên đứng trước). -1 nếu không có ứng
 * viên dùng được (rỗng, chỉ trống, không có nốt).
 */
export function pickMelody(cands: readonly MelodyCandidate[]): number {
  let best = -1;
  let bestCost = Infinity;
  cands.forEach((c, i) => {
    const cost = melodyCost(c);
    if (cost < bestCost - 1e-9) {
      best = i;
      bestCost = cost;
    }
  });
  return best;
}

/**
 * 1 − (thời lượng nốt bị chồng / tổng thời lượng nốt), `notes` sắp theo thời điểm bắt đầu. Không có
 * độ dài → 1. Đuôi nốt vang quá onset kế tiếp không quá `legato` là chơi liền tiếng (legato), không
 * phải chồng: cắt tại onset đó trước khi đo (cùng dung sai với extractMelody — D-126). Đơn vị tùy ý
 * (tick hoặc beat), miễn `legato` cùng đơn vị.
 */
export function monophonicRatio(
  notes: ReadonlyArray<{ readonly start: number; readonly dur: number }>,
  legato: number,
): number {
  let total = 0;
  const pts: Array<[number, number]> = [];
  /** Nốt đầu tiên bắt đầu sau nốt đang xét (notes sắp theo start → chỉ tiến). */
  let next = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (!(n.dur > 0)) continue;
    if (next <= i) next = i + 1;
    while (next < notes.length && notes[next].start <= n.start) next++;
    let end = n.start + n.dur;
    if (next < notes.length) {
      const onset = notes[next].start;
      if (end > onset && end - onset <= legato) end = onset;
    }
    total += end - n.start;
    pts.push([n.start, 1], [end, -1]);
  }
  if (total === 0) return 1;
  // cùng thời điểm: kết thúc trước bắt đầu → nốt nối liền không tính là chồng
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let prev = 0;
  let overlapped = 0;
  for (const [t, d] of pts) {
    if (active >= 2) overlapped += active * (t - prev);
    active += d;
    prev = t;
  }
  return Math.max(0, 1 - overlapped / total);
}
