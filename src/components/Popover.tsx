import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/* ==========================================================================
   A minimal popover: click the trigger to open, click outside or press Escape
   to close. Used for the filter menus.

   Rolling this by hand rather than pulling in a floating-ui dependency — the
   menus here are all anchored bottom-left and never need collision flipping.
   ========================================================================== */

export function Popover({
  label,
  count,
  children,
  align = 'left',
}: {
  label: ReactNode
  count?: number
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        // Return focus to the trigger so keyboard users don't lose their place.
        wrap.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="pop" ref={wrap}>
      <button
        className={`pop__trigger${open ? ' is-open' : ''}${count ? ' has-count' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {label}
        {count ? <span className="pop__count">{count}</span> : null}
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
          <path d="m4 6.5 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className={`pop__panel pop__panel--${align}`} role="dialog">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** Checkbox row used inside every filter menu. */
export function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label className="checkrow">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="checkrow__box" aria-hidden="true">
        {checked && (
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
            <path
              d="m3.5 8.5 3 3 6-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="checkrow__label">{children}</span>
    </label>
  )
}
