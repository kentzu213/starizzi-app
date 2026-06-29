import React from 'react';
import { AppLogoMark, CloseIcon, MaximizeIcon, MinimizeIcon } from './AppIcons';

export function TitleBar() {
  const handleMinimize = () => window.electronAPI?.window.minimize();
  const handleMaximize = () => window.electronAPI?.window.maximize();
  const handleClose = () => window.electronAPI?.window.close();

  return (
    <div className="titlebar glass-surface">
      <div className="titlebar__logo">
        <div className="titlebar__logo-icon">
          <AppLogoMark />
        </div>
        <div className="titlebar__brand-text">
          <span className="titlebar__brand-name">IZZI</span>
          <span className="titlebar__brand-suffix">MEMORY UNIVERSE</span>
        </div>
      </div>
      <div className="titlebar__controls">
        <button className="titlebar__btn" onClick={handleMinimize} title="Minimize">
          <MinimizeIcon className="titlebar__btn-icon" />
        </button>
        <button className="titlebar__btn" onClick={handleMaximize} title="Maximize">
          <MaximizeIcon className="titlebar__btn-icon" />
        </button>
        <button className="titlebar__btn titlebar__btn--close" onClick={handleClose} title="Close">
          <CloseIcon className="titlebar__btn-icon" />
        </button>
      </div>
    </div>
  );
}
