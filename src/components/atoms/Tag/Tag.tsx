import { focusRingClassNames } from '../focus-ring';
import { Icon } from '../Icon';
import type { TagProps } from './tag.types';

export function Tag({ children, onRemove, removeLabel = 'Remove' }: TagProps) {
  return (
    <span className="inline-flex items-center gap-xs rounded-pill border border-lowlight bg-white px-sm py-xs text-body3 text-headings">
      {children}
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className={`inline-flex rounded-pill text-subtitles hover:text-headings ${focusRingClassNames}`}
        >
          <Icon name="close" size="xs" />
        </button>
      )}
    </span>
  );
}
