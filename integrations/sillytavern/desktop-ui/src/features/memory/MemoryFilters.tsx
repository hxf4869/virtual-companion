import type { MemoryFilters as MemoryFilterValues } from '../../data/queries/memory';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Select } from '../../design/components/Select';
import { TextInput } from '../../design/components/TextInput';
import {
  EMPTY_MEMORY_FILTERS,
  MEMORY_SOURCE_OPTIONS,
  MEMORY_STATUS_OPTIONS,
  MEMORY_TYPE_OPTIONS,
} from './useMemoryState';

export interface MemoryFiltersProps {
  filters: MemoryFilterValues;
  onChange: (next: MemoryFilterValues) => void;
  onReset?: () => void;
}

export function MemoryFilters({ filters, onChange, onReset }: MemoryFiltersProps) {
  const currentType = String(filters.type ?? '');
  const currentSource = String(filters.source ?? '');
  const currentDate = String(filters.date ?? '');
  const currentStatus = String(filters.status ?? '');
  const currentQuery = String(filters.q ?? '');

  const hasActiveFilter = Boolean(
    currentType || currentSource || currentDate || currentStatus || currentQuery,
  );

  const updateField = (key: keyof MemoryFilterValues, value: string) => {
    onChange({
      ...filters,
      [key]: value,
    });
  };

  return (
    <aside className="vc-memory-filters" aria-label="记忆筛选">
      <div className="vc-memory-filters__group">
        <span className="vc-memory-filters__heading">关键词</span>
        <TextInput
          aria-label="搜索记忆"
          placeholder="搜索记忆摘要…"
          value={currentQuery}
          onValueChange={(val) => updateField('q', val)}
        />
      </div>

      <div className="vc-memory-filters__group">
        <span className="vc-memory-filters__heading">记忆类型</span>
        <div className="vc-memory-filters__chips" role="group" aria-label="按类型筛选">
          {MEMORY_TYPE_OPTIONS.map((opt) => {
            const pressed = currentType === opt.value;
            return (
              <button
                key={opt.value || 'all-types'}
                type="button"
                aria-pressed={pressed}
                className={[
                  'vc-memory-chip',
                  pressed ? 'vc-memory-chip--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => updateField('type', pressed && opt.value ? '' : opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="vc-memory-filters__group">
        <span className="vc-memory-filters__heading">记忆来源</span>
        <div className="vc-memory-filters__chips" role="group" aria-label="按来源筛选">
          {MEMORY_SOURCE_OPTIONS.map((opt) => {
            const pressed = currentSource === opt.value;
            return (
              <button
                key={opt.value || 'all-sources'}
                type="button"
                aria-pressed={pressed}
                className={[
                  'vc-memory-chip',
                  pressed ? 'vc-memory-chip--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => updateField('source', pressed && opt.value ? '' : opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="vc-memory-filters__group">
        <Field label="按日期筛选">
          <input
            aria-label="按日期筛选"
            type="date"
            className="vc-text-input"
            value={currentDate}
            onChange={(e) => updateField('date', e.target.value)}
          />
        </Field>
      </div>

      <div className="vc-memory-filters__group">
        <Field label="生命周期状态">
          <Select
            aria-label="生命周期状态"
            value={currentStatus}
            options={MEMORY_STATUS_OPTIONS}
            onValueChange={(val) => updateField('status', val)}
          />
        </Field>
      </div>

      {hasActiveFilter ? (
        <Button
          variant="gray"
          size="sm"
          onClick={() => {
            if (onReset) {
              onReset();
            } else {
              onChange({ ...EMPTY_MEMORY_FILTERS });
            }
          }}
        >
          重置筛选
        </Button>
      ) : null}
    </aside>
  );
}
