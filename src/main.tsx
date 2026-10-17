import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// CSS nền (token, nút, form, modal…) nạp TRƯỚC mọi view: CSS của view (import qua App) ghi đè được
// app.css ở cùng độ ưu tiên selector, giống các route tải lười (D-237).
import './ui/app.css';
import { App } from './App';
import './desktop/tauriBridge';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
