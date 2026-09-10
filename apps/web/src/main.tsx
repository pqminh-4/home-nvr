import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './style.css';

// StrictMode giúp phát hiện vòng đời không an toàn trước khi tích hợp luồng camera thật.
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
