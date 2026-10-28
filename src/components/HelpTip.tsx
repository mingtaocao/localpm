import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export function HelpTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  function cancelHide() {
    clearTimeout(timer.current);
  }
  function show() {
    cancelHide();
    setOpen(true);
  }
  function hideSoon() {
    cancelHide();
    timer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) setOpen(false);
    }, 120);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !content.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = content.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        12,
        Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 12),
      ),
      top:
        anchor.bottom + 8 + bounds.height <= innerHeight - 12
          ? anchor.bottom + 8
          : Math.max(12, anchor.top - bounds.height - 8),
    });
    function dismiss(event: PointerEvent) {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !content.current?.contains(event.target as Node)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    const close = () => setOpen(false);
    const onScroll = (event: Event) => {
      if (!content.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="help-tip-trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
      >
        <Icon name="help" />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={content}
            role="tooltip"
            className="help-tip-content"
            style={position}
            onMouseEnter={cancelHide}
            onMouseLeave={hideSoon}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
