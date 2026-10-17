import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../ui/settings';
import { DEMO_SONG_ID } from './demoSong';
import { HomeView } from './HomeView';

interface StubProps {
  songId: string;
  home?: boolean;
}

// Player thật (canvas, audio) không cần ở đây: stub ghi lại props. Màn chơi thật của `#/` được kiểm ở
// src/player/PlayerView.layout.test.tsx.
const seen = vi.hoisted(() => ({ props: [] as StubProps[] }));
vi.mock('../player/PlayerView', () => ({
  PlayerView: (props: StubProps) => {
    seen.props.push(props);
    return <h1>player {props.songId}</h1>;
  },
}));

beforeEach(() => {
  seen.props.length = 0;
  useSettings.setState({ language: 'vi', theme: 'dark' });
});

describe('HomeView (#/)', () => {
  it('là màn chơi đầy đủ với bài mẫu (không còn bản demo / menu ☰)', () => {
    render(<HomeView />);
    expect(screen.getByRole('heading', { name: `player ${DEMO_SONG_ID}` })).toBeTruthy();
    expect(DEMO_SONG_ID).toBe('seed-quoc-ca-viet-nam');
    const last = seen.props[seen.props.length - 1];
    expect(last).toEqual({ songId: DEMO_SONG_ID, home: true });
    expect(screen.queryByRole('button', { name: /menu/i })).toBeNull();
    expect(document.querySelector('.home-brand')).toBeNull();
  });
});
