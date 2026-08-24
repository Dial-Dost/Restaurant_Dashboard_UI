
'use client';

import React from 'react';

export interface DockItemData {
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  className?: string;
}

export interface DockSectionData {
  /** Small muted uppercase caption above the group; omit for an untitled group. */
  title?: string;
  items: DockItemData[];
}

export interface DockProps {
  /** Flat list — rendered as a single untitled section. */
  items?: DockItemData[];
  /** Grouped nav: captioned icon groups separated by thin dividers. */
  sections?: DockSectionData[];
  className?: string;
  panelHeight?: number;
  baseItemSize?: number;
}

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
  sections,
  className = '',
  panelHeight = 68,
  baseItemSize = 50,
}: DockProps) {
  // The dock is always icon-only, so a section "header" is a tiny caption
  // above its group plus a hairline divider before the next group — the
  // graceful-collapse form of a sidebar section title.
  const resolvedSections: DockSectionData[] = sections ?? (items ? [{ items }] : []);

  return (
    <div className="dock-outer">
      <div
        className={`dock-panel ${className}`}
        style={{ height: panelHeight }}
        role="toolbar"
        aria-label="Application dock"
      >
        {resolvedSections.map((section, sectionIndex) => (
          <React.Fragment key={section.title ?? `section-${sectionIndex}`}>
            {sectionIndex > 0 && <div className="dock-divider" aria-hidden="true" />}
            <div className="dock-section" role="group" aria-label={section.title}>
              {section.title && <div className="dock-section-title">{section.title}</div>}
              <div className="dock-section-items">
                {section.items.map((item, index) => (
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
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
