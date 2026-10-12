import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
export function MoreMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>();
  const positionMenu = () => {
    if (!ref.current?.open || !menuRef.current) return;
    const trigger = ref.current
      .querySelector("summary")!
      .getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const below = trigger.bottom + 6;
    setPosition({
      position: "fixed",
      right: "auto",
      left: Math.max(
        8,
        Math.min(
          trigger.right - menu.width,
          window.innerWidth - menu.width - 8,
        ),
      ),
      top: Math.max(
        8,
        below + menu.height <= window.innerHeight - 8
          ? below
          : trigger.top - menu.height - 6,
      ),
    });
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    const resize = () => {
      if (ref.current) ref.current.open = false;
    };
    window.addEventListener("resize", resize);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details className="more-menu" ref={ref} onToggle={positionMenu}>
      <summary
        className="icon-button"
        role="button"
        aria-label={label}
        title={label}
      >
        <Icon name="more" />
      </summary>
      <div
        className="dropdown-menu"
        ref={menuRef}
        style={position}
        onClick={(event) => {
          if ((event.target as Element).closest("button") && ref.current)
            ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
