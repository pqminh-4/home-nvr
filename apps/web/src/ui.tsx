import { useEffect, useRef, type ReactNode } from 'react';
import { stateLabels, type DemoState } from './demo';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    camera: 'M3 6h12v12H3zM15 10l6-4v12l-6-4',
    record: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8l6 4-6 4z',
    bell: 'M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8M10 21h4',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
    search: 'm20 20-4.5-4.5M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z',
    plus: 'M12 5v14M5 12h14', more: 'M5 12h.01M12 12h.01M19 12h.01', menu: 'M4 6h16M4 12h16M4 18h16',
    fullscreen: 'M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5', mute: 'M3 9v6h4l5 4V5L7 9H3zM16 9l5 6m0-6-5 6',
    volume: 'M3 9v6h4l5 4V5L7 9H3zM16 8a6 6 0 0 1 0 8', snapshot: 'M3 7h5l2-3h4l2 3h5v13H3zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    chevron: 'm8 10 4 4 4-4', arrow: 'M5 12h14m-6-6 6 6-6 6', activity: 'M2 12h5l3-8 4 16 3-8h5', play: 'm8 5 11 7-11 7z',
    close: 'm6 6 12 12M18 6 6 18', check: 'm5 12 4 4L19 6', shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 12l3 3 5-6',
    disk: 'M4 4h16v16H4zM7 4v6h10V4M8 20v-6h8v6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2',
    lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3', logout: 'M10 5H5v14h5M14 8l4 4-4 4M8 12h10', pause: 'M8 5v14M16 5v14', info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7h.01',
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.grid} /></svg>;
}

export function Badge({ state, children }: { state: DemoState | 'recording'; children?: ReactNode }) {
  const tone = state === 'online' || state === 'recording' ? 'green' : state === 'reconnecting' || state === 'loading' ? 'amber' : 'red';
  return <span className={'badge ' + tone}><span className="dot" />{children ?? (state === 'recording' ? 'Đang ghi' : stateLabels[state])}</span>;
}

// Dialog native cung cấp focus trap, Escape và nền inert; trả focus về nút mở khi đóng.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby="dialog-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}><header className="modal-header"><div><span className="eyebrow">HOME NVR · XEM TRƯỚC</span><h2 id="dialog-title">{title}</h2></div><button className="icon-btn" aria-label="Đóng hộp thoại" onClick={onClose}><Icon name="close" /></button></header>{children}</dialog>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="camera" size={32} /></span><h2>{title}</h2><p>{detail}</p>{action}</div>;
}

export function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <header className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>{action}</header>;
}
