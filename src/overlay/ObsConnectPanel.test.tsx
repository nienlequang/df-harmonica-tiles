import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../ui/settings';
import { ObsConnectPanel } from './ObsConnectPanel';
import {
  OBS_INPUT_NAME,
  OBS_PREFS_KEY,
  getObsBridgeState,
  resetObsBridgeForTests,
} from './obsBridge';
import type { FakeObsOptions } from './testing/fakeObs';
import { installFakeObs } from './testing/fakeObs';

const URL_A = 'https://app.example/#/overlay/seed-x?layout=game&fit=canvas&opacity=0.9';
const URL_B = 'https://app.example/#/overlay/seed-x?layout=game&fit=canvas&opacity=0.6';

function renderPanel(url = URL_A) {
  return render(<ObsConnectPanel overlayUrl={url} />);
}

const passwordBox = () => screen.getByLabelText('Mật khẩu (Server Password)') as HTMLInputElement;
const connectBtn = () => screen.getByRole('button', { name: 'Kết nối' });
const addBtn = () => screen.getByRole('button', { name: /overlay (vào|trong) OBS|Đang thêm/ });

async function connectVia(opts: FakeObsOptions = {}, password = '') {
  const server = installFakeObs(opts);
  renderPanel();
  fireEvent.change(passwordBox(), { target: { value: password } });
  fireEvent.click(connectBtn());
  await waitFor(() => expect(getObsBridgeState().status).not.toBe('connecting'));
  return server;
}

beforeEach(() => {
  resetObsBridgeForTests();
  useSettings.getState().reset();
});

afterEach(() => {
  act(() => resetObsBridgeForTests());
  vi.unstubAllGlobals();
});

describe('ObsConnectPanel', () => {
  it('chưa kết nối: 3 bước trong OBS, ô mật khẩu ẩn ký tự, Nhớ bật sẵn, nâng cao thu gọn, Thêm bị khóa', () => {
    renderPanel();
    expect(
      screen.getByText(
        'Trong OBS: Tools (Công cụ) → WebSocket Server Settings → bật "Enable WebSocket server".',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Bấm "Show Connect Info" → "Copy" ở dòng Server Password, dán vào ô bên dưới.',
      ),
    ).toBeTruthy();
    const pw = passwordBox();
    expect(pw.type).toBe('password');
    expect(pw.getAttribute('autocomplete')).toBe('off');
    expect(pw.getAttribute('aria-describedby')).toBeTruthy();
    const remember = screen.getByRole('checkbox', { name: 'Nhớ trên máy này' }) as HTMLInputElement;
    expect(remember.checked).toBe(true);
    const details = screen.getByText('Nâng cao: địa chỉ và cổng').closest('details');
    expect(details?.open).toBe(false);
    expect((screen.getByLabelText('Địa chỉ') as HTMLInputElement).value).toBe('127.0.0.1');
    expect((screen.getByLabelText('Cổng') as HTMLInputElement).value).toBe('4455');
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ngắt kết nối' })).toBeNull();
    expect(
      screen.getByText(/chỉ nói chuyện với OBS trên chính máy này \(127\.0\.0\.1\)/),
    ).toBeTruthy();
  });

  it('Kết nối được: dòng trạng thái có phiên bản OBS, form ẩn, nút Thêm bật + nhận focus', async () => {
    const server = installFakeObs({ password: 'pw' });
    renderPanel();
    fireEvent.change(passwordBox(), { target: { value: 'pw' } });
    fireEvent.click(connectBtn());
    expect(screen.getByText('Đang kết nối OBS ở 127.0.0.1:4455…')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Đang kết nối…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await screen.findByText('Đã kết nối OBS 31.0.2 — màn chơi đang điều khiển overlay trong OBS.');
    expect(screen.queryByLabelText('Mật khẩu (Server Password)')).toBeNull();
    const add = screen.getByRole('button', { name: 'Thêm overlay vào OBS' }) as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(document.activeElement).toBe(add);
    expect(screen.getByRole('button', { name: 'Ngắt kết nối' })).toBeTruthy();
    expect(server.lastAuth).toBeTruthy();
    // Nhớ (mặc định bật) → đã lưu.
    expect(JSON.parse(localStorage.getItem(OBS_PREFS_KEY) ?? '{}')).toMatchObject({
      password: 'pw',
      auto: true,
    });
  });

  it('sai mật khẩu → câu hướng dẫn cụ thể, form còn nguyên', async () => {
    await connectVia({ password: 'right' }, 'wrong');
    expect(
      await screen.findByText(
        'Sai mật khẩu. Trong OBS: WebSocket Server Settings → Show Connect Info → copy lại Server Password.',
      ),
    ).toBeTruthy();
    expect(passwordBox()).toBeTruthy();
    expect((addBtn() as HTMLButtonElement).disabled).toBe(true);
  });

  it('OBS chưa mở / chưa bật WebSocket → câu hướng dẫn kèm địa chỉ', async () => {
    await connectVia({ refuse: true });
    expect(await screen.findByText(/^Không kết nối được OBS ở 127\.0\.0\.1:4455\./)).toBeTruthy();
  });

  it('OBS cần mật khẩu mà ô trống → nhắc dán Server Password', async () => {
    await connectVia({ password: 'pw' }, '');
    expect(await screen.findByText(/OBS yêu cầu mật khẩu/)).toBeTruthy();
  });

  it('cổng ở mục nâng cao được dùng', async () => {
    const server = installFakeObs();
    renderPanel();
    fireEvent.click(screen.getByText('Nâng cao: địa chỉ và cổng'));
    fireEvent.change(screen.getByLabelText('Cổng'), { target: { value: '4460' } });
    fireEvent.click(connectBtn());
    await screen.findByText(/^Đã kết nối OBS/);
    expect(server.sockets[0]?.url).toBe('ws://127.0.0.1:4460');
  });

  it('Thêm overlay → dòng kết quả; đổi tùy chọn → nhắc cập nhật; cập nhật → "Đã cập nhật"', async () => {
    const server = installFakeObs();
    const view = renderPanel(URL_A);
    fireEvent.click(connectBtn());
    await screen.findByText(/^Đã kết nối OBS/);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm overlay vào OBS' }));
    expect(
      await screen.findByText(
        `Đã thêm "${OBS_INPUT_NAME}" vào cảnh Game (1920 × 1080) — ô rơi tự khớp bảng phím và chạy theo màn chơi.`,
      ),
    ).toBeTruthy();
    expect(server.inputs[0]?.inputSettings.url).toBe(URL_A);

    view.rerender(<ObsConnectPanel overlayUrl={URL_B} />);
    expect(
      screen.getByText(
        'Tùy chọn hiển thị ở trên vừa đổi — bấm "Cập nhật overlay trong OBS" để áp dụng.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật overlay trong OBS' }));
    expect(
      await screen.findByText(
        `Đã cập nhật "${OBS_INPUT_NAME}" trong cảnh Game (1920 × 1080) — ô rơi tự khớp bảng phím và chạy theo màn chơi.`,
      ),
    ).toBeTruthy();
    expect(server.inputs[0]?.inputSettings.url).toBe(URL_B);
    expect(screen.queryByText(/Tùy chọn hiển thị ở trên vừa đổi/)).toBeNull();
  });

  it('Thêm lỗi (trùng tên với source khác loại) → cảnh báo, vẫn kết nối', async () => {
    const server = installFakeObs();
    server.inputs.push({ inputName: OBS_INPUT_NAME, inputKind: 'text_gdiplus', inputSettings: {} });
    renderPanel();
    fireEvent.click(connectBtn());
    await screen.findByText(/^Đã kết nối OBS/);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm overlay vào OBS' }));
    expect(
      await screen.findByText(/đã có một source \/ cảnh tên "DF Harmonica Tiles"/),
    ).toBeTruthy();
    expect(getObsBridgeState().status).toBe('connected');
  });

  it('OBS từ chối (mã 207 chưa sẵn sàng) → câu "OBS đang bận"', async () => {
    const server = installFakeObs();
    server.overrides.set('GetVideoSettings', () => ({ ok: false, code: 207 }));
    renderPanel();
    fireEvent.click(connectBtn());
    await screen.findByText(/^Đã kết nối OBS/);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm overlay vào OBS' }));
    expect(await screen.findByText(/^OBS đang bận/)).toBeTruthy();
  });

  it('Ngắt kết nối → form hiện lại, focus về nút Kết nối, kết quả cũ biến mất', async () => {
    installFakeObs();
    renderPanel();
    fireEvent.click(connectBtn());
    await screen.findByText(/^Đã kết nối OBS/);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm overlay vào OBS' }));
    await screen.findByText(/^Đã thêm/);
    fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối' }));
    expect(getObsBridgeState().status).toBe('off');
    expect(document.activeElement).toBe(connectBtn());
    expect(screen.queryByText(/^Đã thêm/)).toBeNull();
    expect(screen.queryByText(/^Đã kết nối OBS/)).toBeNull();
  });

  it('mật khẩu đã nhớ: điền sẵn + tự kết nối khi khối mở ra; bỏ Nhớ → xóa ngay', async () => {
    localStorage.setItem(
      OBS_PREFS_KEY,
      JSON.stringify({
        v: 1,
        remember: true,
        host: '127.0.0.1',
        port: 4455,
        password: 'pw',
        auto: true,
      }),
    );
    installFakeObs({ password: 'pw' });
    renderPanel();
    expect(screen.getByText('Đang chờ OBS ở 127.0.0.1:4455 — tự thử lại…')).toBeTruthy();
    await screen.findByText(/^Đã kết nối OBS/);
    fireEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối' }));
    expect(passwordBox().value).toBe('pw');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Nhớ trên máy này' }));
    expect(JSON.parse(localStorage.getItem(OBS_PREFS_KEY) ?? '{}')).toEqual({
      v: 1,
      remember: false,
    });
  });

  it('tiếng Anh', async () => {
    useSettings.getState().set({ language: 'en' });
    installFakeObs();
    renderPanel();
    expect(screen.getByLabelText('Password (Server Password)')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Remember on this device' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByText('Connected to OBS 31.0.2 — the Player now drives the overlay in OBS.');
    fireEvent.click(screen.getByRole('button', { name: 'Add overlay to OBS' }));
    expect(
      await screen.findByText(
        'Added "DF Harmonica Tiles" to scene Game (1920 × 1080) — the tiles line up with the key panel and follow the Player.',
      ),
    ).toBeTruthy();
  });
});
