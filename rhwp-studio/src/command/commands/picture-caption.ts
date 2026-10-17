import type { CommandDef, CommandServices, EditorContext } from '../types';
import { SnapshotCommand } from '@/engine/command';
import { getObjectProps, setObjectProps } from '@/engine/object-props';

/** Same defaults as caption entry and the picture property dialog. */
export const DEFAULT_PICTURE_CAPTION_PROPS = {
  hasCaption: true,
  captionDirection: 'Bottom',
  captionVertAlign: 'Top',
  captionWidth: Math.round(30 * 283.46),
  captionSpacing: Math.round(3 * 283.46),
  captionIncludeMargin: false,
} as const;

function editableBody(c: EditorContext): boolean {
  return c.hasDocument && c.isEditable && !c.isFormMode && c.editMode === 'normal'
    && c.inPictureObjectSelection && !c.inCellSelectionMode && !c.inTableObjectSelection;
}

type PictureCaptionContext = EditorContext & {canSetPictureCaptionPosition?: boolean};

/** Shared by current-source menu context and execution; no cached selection state. */
function supportedTarget(
  ih: ReturnType<CommandServices['getInputHandler']>, wasm: CommandServices['wasm'],
) {
  try {
    if (!ih || ih.isFormMode() || ih.isMultiPictureSelection()) return null;
    const selected = ih.getSelectedPictureRef();
    if (!selected || selected.type !== 'image' || selected.cellPath?.length
      || selected.cellIdx !== undefined || selected.cellParaIdx !== undefined
      || selected.outerTableControlIdx !== undefined || selected.headerFooter || selected.noteRef) return null;
    const ref = {...selected};
    const props = getObjectProps(wasm, ref);
    if (typeof props.hasCaption !== 'boolean' || typeof props.rotationAngle !== 'number'
      || !Number.isFinite(props.rotationAngle) || props.rotationAngle % 360 !== 0
      || (props.hasCaption && props.captionDirection !== 'Top' && props.captionDirection !== 'Bottom')) return null;
    return {ih, ref, props};
  } catch { return null; }
}

/** Read only; getContext includes this result for menu/dispatcher availability. */
export function pictureCaptionAvailability(
  ih: ReturnType<CommandServices['getInputHandler']>, wasm: CommandServices['wasm'],
) {
  return {canSetPictureCaptionPosition: supportedTarget(ih, wasm) !== null};
}

/** Position menus share the existing property setter; snapshots retain removed content. */
export function pictureCaptionPositionCommand(position: 'Top' | 'Bottom' | null): CommandDef {
  return {
    id: `insert:caption-${position === null ? 'none' : position.toLowerCase()}`,
    label: position === null ? '캡션 없음' : `캡션 - ${position === 'Top' ? '위' : '아래'}`,
    canExecute: c => editableBody(c) && (c as PictureCaptionContext).canSetPictureCaptionPosition === true,
    execute(services) {
      if (!editableBody(services.getContext())) return;
      const target = supportedTarget(services.getInputHandler(), services.wasm);
      if (!target) return;
      const {ih, ref, props} = target;
      // Preserve pending redo, cursor and selection as well as the undo depth.
      if (position === null ? !props.hasCaption : props.hasCaption && props.captionDirection === position) return;
      // Object selection can leave the old caret in a cell. Use the selected
      // picture's body anchor, including documents with no adjacent paragraph.
      const anchor = ih.getPositionOutsideSelectedPicture() ?? {
        sectionIndex: ref.sec, paragraphIndex: ref.ppi,
        charOffset: services.wasm.getParagraphLength(ref.sec, ref.ppi),
      };
      if (anchor.parentParaIndex !== undefined || anchor.cellPath?.length || anchor.isTextBox) return;
      const patch = position === null ? {hasCaption: false}
        : props.hasCaption ? {hasCaption: true, captionDirection: position}
        : {...DEFAULT_PICTURE_CAPTION_PROPS, captionDirection: position};
      let applied = false;
      ih.executeOperation({
        kind: 'command',
        command: new SnapshotCommand('setPictureCaptionPosition', {...anchor}, {...anchor}, wasm => {
          const result = setObjectProps(wasm, ref, patch) as {ok?: boolean} | undefined;
          if (result?.ok !== true) throw new Error('그림 캡션 위치를 적용하지 못했습니다.');
          const after = getObjectProps(wasm, ref);
          if (after.hasCaption !== (position !== null) || (position !== null && after.captionDirection !== position)) {
            throw new Error('그림 캡션 위치 변경을 확인하지 못했습니다.');
          }
          applied = true;
          return {...anchor};
        }),
        meta: {refresh: 'full'},
      });
      if (applied) ih.selectPictureObject(ref.sec, ref.ppi, ref.ci, 'image');
    },
  };
}
