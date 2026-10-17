// Phát hành: npm run release -- <patch|minor|major> [--dry-run]
//   1. Kiểm tra working tree sạch.
//   2. Tính version mới, đổi "## [Unreleased]" trong CHANGELOG.md thành mục version + ngày.
//   3. npm version <x.y.z> --no-git-tag-version (package.json + package-lock.json).
//   4. Commit "chore(release): vX.Y.Z" + tag vX.Y.Z (local; nếu có git remote thì push luôn).
// Sau đó đưa bản mới lên Vercel bằng: npm run deploy:prod
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const type = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');

if (!['patch', 'minor', 'major'].includes(type ?? '')) {
  console.error('Cách dùng: npm run release -- <patch|minor|major> [--dry-run]');
  process.exit(1);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const run = (cmd, a) =>
  execFileSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' });

if (git('status', '--porcelain')) {
  console.error('Working tree chưa sạch — commit hoặc stash trước khi release.');
  if (!dryRun) process.exit(1);
}

const pkgUrl = new URL('../package.json', import.meta.url);
const current = JSON.parse(readFileSync(pkgUrl, 'utf8')).version;
const [major, minor, patch] = current.split('-')[0].split('.').map(Number);
const next =
  type === 'major'
    ? `${major + 1}.0.0`
    : type === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
const tag = `v${next}`;
const today = new Date().toISOString().slice(0, 10);

const changelogUrl = new URL('../CHANGELOG.md', import.meta.url);
const changelog = readFileSync(changelogUrl, 'utf8').replace(/\r\n/g, '\n');
if (!changelog.includes('## [Unreleased]')) {
  console.error('CHANGELOG.md không có mục "## [Unreleased]".');
  process.exit(1);
}
const updated = changelog.replace('## [Unreleased]', `## [Unreleased]\n\n## [${next}] - ${today}`);

console.log(`${current} → ${next} (${tag})${dryRun ? ' [dry-run]' : ''}`);
if (dryRun) {
  console.log(updated.split('\n').slice(0, 14).join('\n'));
  process.exit(0);
}

writeFileSync(changelogUrl, updated);
run('npm', ['version', next, '--no-git-tag-version']);
git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md');
git('commit', '-m', `chore(release): ${tag}`);
git('tag', '-a', tag, '-m', tag);

let remote = '';
try {
  remote = git('remote');
} catch {
  // không có remote
}
if (remote) run('git', ['push', '--follow-tags']);
console.log(`Đã tạo ${tag}. Đưa lên Vercel: npm run deploy:prod`);
