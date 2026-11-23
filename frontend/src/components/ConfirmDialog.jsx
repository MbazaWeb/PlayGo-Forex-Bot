import React, { useEffect, useId, useRef } from 'react';

export default function ConfirmDialog({ title, children, confirmLabel, confirmDisabled = false, onCancel, onConfirm }) {
  const dialog = useRef(null);
  const heading = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={heading}
      onCancel={event => { event.preventDefault(); onCancel(); }}>
      <h2 id={heading}>{title}</h2>
      {children}
      <div className="confirm-actions">
        <button type="button" className="outline" autoFocus onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
