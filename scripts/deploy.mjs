// Deploy thẳng từ máy lên Vercel (không cần GitHub):
//   npm run deploy        → npm run check, rồi deploy bản PREVIEW (link riêng, không đụng production)
//   npm run deploy:prod   → npm run check, rồi deploy PRODUCTION
//   thêm `-- --skip-check` để bỏ qua check (không khuyến khích).
// Lần đầu Vercel CLI sẽ hỏi đăng nhập (mở trình duyệt) và liên kết project — chỉ làm một lần, thông tin
// liên kết lưu trong thư mục .vercel/ (đã gitignore). Vercel build lại từ source theo vercel.json.
import { execFileSync } from 'node:child_process';

const VERCEL_CLI = 'vercel@64.0.2';
const args = process.argv.slice(2);
const prod = args.includes('--prod');
const skipCheck = args.includes('--skip-check');

const run = (cmd, a) =>
  execFileSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' });

/**
 * Commit ngắn cho trang Dev notes (`#/dev`, `__BUILD_COMMIT__` trong vite.config.ts): Vercel build lại từ source
 * không có .git → truyền qua `--build-env DFHT_COMMIT=…` (`-dirty` = có thay đổi chưa commit, kể cả file mới
 * chưa add — R7C-2). Không có git → bỏ.
 */
function gitCommit() {
  const git = (a) =>
    execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const sha = git(['rev-parse', '--short', 'HEAD']);
    // `status --porcelain` tính cả file MỚI chưa add (diff HEAD thì không): commit thiếu file mới → vẫn -dirty.
    // `--no-optional-locks`: không ghi lại index (chỉ đọc).
    return git(['--no-optional-locks', 'status', '--porcelain']) === '' ? sha : `${sha}-dirty`;
  } catch {
    return '';
  }
}

try {
  if (!skipCheck) run('npm', ['run', 'check']);
  const commit = gitCommit();
  run('npx', [
    '--yes',
    VERCEL_CLI,
    'deploy',
    ...(prod ? ['--prod'] : []),
    ...(commit ? ['--build-env', `DFHT_COMMIT=${commit}`] : []),
  ]);
} catch {
  console.error(prod ? 'Deploy production thất bại.' : 'Deploy preview thất bại.');
  process.exit(1);
}
