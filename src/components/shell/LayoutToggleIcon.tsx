interface LayoutToggleIconProps {
  side: 'left' | 'right'
  filled: boolean
}

export function LayoutToggleIcon({ side, filled }: LayoutToggleIconProps) {
  const clipId = side === 'left' ? 'layout-toggle-clip-left' : 'layout-toggle-clip-right'
  const pane = side === 'left'
    ? { x: 1.5, width: 4 }
    : { x: 10.5, width: 4 }
  const divider = side === 'left' ? 5.5 : 10.5

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.25" />
        </clipPath>
      </defs>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.25" stroke="currentColor" strokeWidth="1.2" />
      <path d={`M${divider} 2.5v11`} stroke="currentColor" strokeWidth="1.2" />
      {filled && <rect x={pane.x} y="2.5" width={pane.width} height="11" fill="currentColor" clipPath={`url(#${clipId})`} />}
    </svg>
  )
}
