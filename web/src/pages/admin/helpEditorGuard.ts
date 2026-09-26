// web/src/pages/admin/helpEditorGuard.ts
//
// Tiny cross-component flag so the admin shell can warn about unsaved help
// edits when switching sections. The editor registers its dirty state here.

let dirty = false;

export function setHelpEditorDirty(value: boolean): void {
  dirty = Boolean(value);
}

export function isHelpEditorDirty(): boolean {
  return dirty;
}
