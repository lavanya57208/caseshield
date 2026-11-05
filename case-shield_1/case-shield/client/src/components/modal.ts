import { icon } from "./icons.js";

export interface ModalHandle {
  el: HTMLElement;
  close: () => void;
}

export function openModal(title: string, bodyHtml: string, footHtml = ""): ModalHandle {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close" type="button" data-el="modal-close">${icon("x", 18)}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector('[data-el="modal-close"]')!.addEventListener("click", close);

  return { el: backdrop, close };
}
