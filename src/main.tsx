import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from './core/constants';
import { applyTheme, storedTheme } from './ui/theme';
import './ui/theme.css';
import { App } from './App';

document.title = APP_NAME;
applyTheme(storedTheme(), false);

const root = document.getElementById('root');
if (!root) throw new Error('#root 없음');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
