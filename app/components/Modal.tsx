import { useEffect, useId, useState, type ReactNode } from "react";

type ModalProps = {
  title: string;
  triggerLabel: string;
  children: ReactNode;
  closeSignal?: unknown;
  size?: "normal" | "wide";
  triggerClassName?: string;
};

export function Modal({ title, triggerLabel, children, closeSignal, size = "normal", triggerClassName = "primary" }: ModalProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (closeSignal) setOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <>
    <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>{triggerLabel}</button>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={`modal-card ${size === "wide" ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="modal-close" aria-label="关闭" onClick={() => setOpen(false)}>×</button></header>
        <div className="modal-body">{children}</div>
      </section>
    </div>}
  </>;
}
