import { installResizeObserverNoiseSuppression } from './suppressResizeObserverDevNoise';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import '@xyflow/react/dist/style.css';

import App from './App';

installResizeObserverNoiseSuppression();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
