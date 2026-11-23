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
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-label={label}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
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
