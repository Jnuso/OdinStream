import { useEffect, useRef, type ReactNode } from "react";

export default function Modal({
  label,
  onClose,
  children,
  className,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-label={label}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button className="close" aria-label={`Close ${label}`} onClick={onClose}>
        ×
      </button>
      {children}
    </dialog>
  );
}
