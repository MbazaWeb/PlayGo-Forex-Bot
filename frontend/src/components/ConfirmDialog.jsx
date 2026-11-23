import { X } from 'lucide-react';
import React, { useEffect, useId, useRef } from 'react';

export default function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancel', onCancel, onConfirm }) {
  const dialog = useRef(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); onCancel(); }}>
      <header className="dialog-heading"><h2 id={heading}>{title}</h2>
        <button type="button" className="dialog-dismiss" aria-label="Dismiss dialog" onClick={onCancel}><X size={18} /></button></header>
      <div className="dialog-body">{children}</div>
      <div className="confirm-actions">
        <button type="button" className="outline" autoFocus onClick={onCancel}>{cancelLabel}</button>
        {onConfirm && <button type="button" className="primary" onClick={onConfirm}>{confirmLabel}</button>}
      </div>
    </dialog>
  );
}
