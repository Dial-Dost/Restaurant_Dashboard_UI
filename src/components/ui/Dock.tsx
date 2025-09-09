
'use client';

import React, { useState } from 'react';

export type DockItemData = {
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  className?: string;
};

export type DockProps = {
  items: DockItemData[];
  className?: string;
  panelHeight?: number;
  baseItemSize?: number;
};

function DockItem({
  children,
  className = '',
  onClick,
  baseItemSize
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  baseItemSize: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`dock-item ${className}`}
      style={{
        width: `${baseItemSize}px`,
        height: `${baseItemSize}px`,
      }}
      tabIndex={0}
      role="button"
    >
      {children}
    </button>
  );
}

function DockLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="dock-label" role="tooltip">
      {children}
    </div>
  );
}

function DockIcon({ children }: { children: React.ReactNode }) {
  return <div className="dock-icon">{children}</div>;
}

export default function Dock({
  items,
  className = '',
  panelHeight = 68,
  baseItemSize = 50,
}: DockProps) {

  return (
    <div className="dock-outer">
      <div
        className={`dock-panel ${className}`}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Application dock"
      >
        {items.map((item, index) => (
          <DockItem
            key={index}
            onClick={item.onClick}
            className={item.className}
            baseItemSize={baseItemSize}
          >
            <DockIcon>{item.icon}</DockIcon>
            <DockLabel>{item.label}</DockLabel>
          </DockItem>
        ))}
      </div>
    </div>
  );
}
