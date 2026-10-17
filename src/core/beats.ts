/**
 * Đọc / ghi độ dài (beat) cho định dạng `.harm`.
 *
 * - Thập phân: `1`, `1.5`, `.5`, `0.25`, `2.`
 * - Phân số: `a/b` với a, b thập phân, b ≠ 0 (vd. `1/3` cho chùm ba — D-015).
 *
 * `parseBeats(formatBeats(n)) === n` với mọi n > 0 hữu hạn.
 */

/**
 * Không mơ hồ: phần nguyên và phần thập phân chỉ tách được ở dấu chấm, nên chuỗi số dài sai ở cuối
 * bị loại trong thời gian tuyến tính (`\d+\.?\d*` cũ backtrack O(n²) — chuỗi chục nghìn chữ số
 * treo parser).
 */
const DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

function strictDecimal(t: string): number | null {
  if (!DECIMAL_RE.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Số thập phân không dấu, không mũ (`1`, `1.5`, `.5`, `2.`). Trả null nếu sai dạng. */
export function parseDecimal(s: string): number | null {
  return strictDecimal(s.trim());
}

/** Độ dài beat (> 0, hữu hạn) từ thập phân hoặc phân số `a/b`; sai → null. */
export function parseBeats(s: string): number | null {
  const t = s.trim();
  const slash = t.indexOf('/');
  let v: number | null;
  if (slash >= 0) {
    const a = strictDecimal(t.slice(0, slash));
    const b = strictDecimal(t.slice(slash + 1));
    if (a === null || b === null || b === 0) return null;
    v = a / b;
  } else {
    v = strictDecimal(t);
  }
  return v !== null && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Số → chuỗi thập phân thường (không dạng mũ), đọc lại bằng `Number()` ra đúng số đó.
 * `1e-7` → `0.0000001`, `1e+21` → `1000000000000000000000`.
 */
export function formatDecimal(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
  if (!m) return s;
  const sign = m[1] ?? '';
  const intPart = m[2] ?? '';
  const frac = m[3] ?? '';
  const exp = Number(m[4]);
  const digits = intPart + frac;
  // vị trí dấu chấm thập phân trong chuỗi digits
  const point = intPart.length + exp;
  let out: string;
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + out;
}

/**
 * Beat → chuỗi ngắn gọn: thập phân hữu hạn (`0.5`, `0.25`, `0.125`, `1.5`), còn số dài
 * mà biểu diễn đúng bằng k/d (d ≤ 64) thì ghi phân số tối giản (`1/3`, `2/3`).
 */
export function formatBeats(n: number): string {
  const s = formatDecimal(n);
  if (!Number.isFinite(n) || Number.isInteger(n) || s.length <= 6) return s;
  for (let d = 2; d <= 64; d++) {
    const k = Math.round(n * d);
    if (k / d === n) {
      // d nhỏ nhất thỏa mãn → phân số đã tối giản
      const f = `${k}/${d}`;
      return f.length < s.length ? f : s;
    }
  }
  return s;
}
