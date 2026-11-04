import { useEffect, useState } from 'react';
import { useDiaries, useDiaryEntry, type DiaryEntry } from '../../data/queries/memory';
import { Button } from '../../design/components/Button';
import { EmptyState } from '../../design/components/EmptyState';
import {
  DIARY_EMPTY,
  DIARY_FONT_BUTTON,
  DIARY_MOMENTS,
  diaryDayTitle,
  ensureHandwriting,
  localDay,
  monthDays,
  monthLabel,
  monthOfDay,
  readDiaryFont,
  shiftMonth,
  writeDiaryFont,
} from '../../../../extension/vc-model-settings/memory-logic.js';

export interface DiaryProps {
  relId: string | null;
}

export function Diary({ relId }: DiaryProps) {
  const today = localDay();
  const [month, setMonth] = useState<string>(() => monthOfDay(today));
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [fontMode, setFontMode] = useState<'body' | 'hand'>(() => readDiaryFont());

  const diariesQuery = useDiaries(relId, month);
  const entries = diariesQuery.data ?? [];

  const entriesByDay = new Map<string, DiaryEntry>();
  for (const entry of entries) {
    const dayKey = String(entry.day ?? entry.entryDate ?? '');
    if (dayKey) {
      entriesByDay.set(dayKey, entry);
    }
  }

  useEffect(() => {
    if (fontMode === 'hand') {
      ensureHandwriting();
    }
  }, [fontMode]);

  useEffect(() => {
    const sortedDays = Array.from(entriesByDay.keys()).sort();
    if (!selectedDay.startsWith(month)) {
      const fallback = sortedDays.at(-1) || `${month}-01`;
      setSelectedDay(fallback);
    } else if (!entriesByDay.has(selectedDay) && sortedDays.length > 0) {
      setSelectedDay(sortedDays[sortedDays.length - 1]);
    }
  }, [month, entries.length]);

  const summaryEntry = entriesByDay.get(selectedDay) ?? null;
  const summaryEntryId = summaryEntry ? String(summaryEntry.diaryId ?? summaryEntry.id ?? '') : null;
  const needFullFetch = Boolean(summaryEntryId && !summaryEntry?.body && !summaryEntry?.content);
  const fullEntryQuery = useDiaryEntry(needFullFetch ? summaryEntryId : null);

  const activeEntry = fullEntryQuery.data ?? summaryEntry;
  const days = monthDays(month);
  const moments = activeEntry?.moments ?? activeEntry?.highlights ?? [];

  const handleToggleFont = () => {
    const next = writeDiaryFont(fontMode === 'hand' ? 'body' : 'hand');
    setFontMode(next);
  };

  return (
    <section className="vc-memory-diary" aria-label="角色日记">
      <div className="vc-memory-diary__toolbar">
        <div className="vc-memory-diary__month-nav">
          <Button
            variant="gray"
            size="sm"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            上一月
          </Button>
          <strong className="vc-memory-diary__month-label">{monthLabel(month)}</strong>
          <Button
            variant="gray"
            size="sm"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            下一月
          </Button>
        </div>

        <Button
          variant={fontMode === 'hand' ? 'filled' : 'gray'}
          size="sm"
          aria-pressed={fontMode === 'hand'}
          onClick={handleToggleFont}
        >
          {DIARY_FONT_BUTTON} 手写体
        </Button>
      </div>

      <div className="vc-memory-diary__days" role="listbox" aria-label="选择日期">
        {days.map((dayStr: string) => {
          const dayNum = Number(dayStr.slice(-2));
          const hasEntry = entriesByDay.has(dayStr);
          const isCurrent = selectedDay === dayStr;
          return (
            <button
              key={dayStr}
              type="button"
              role="option"
              aria-selected={isCurrent}
              className={[
                'vc-memory-diary__day-btn',
                isCurrent ? 'vc-memory-diary__day-btn--active' : '',
                hasEntry ? 'vc-memory-diary__day-btn--has-entry' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelectedDay(dayStr)}
            >
              <span>{dayNum}</span>
              {hasEntry ? <span className="vc-memory-diary__dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <div
        className={[
          'vc-memory-diary__paper',
          fontMode === 'hand' ? 'vc-memory-diary__paper--hand' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <h3 className="vc-memory-diary__date-title">{diaryDayTitle(selectedDay)}</h3>
        {!activeEntry ? (
          <EmptyState icon="book" title={DIARY_EMPTY} />
        ) : (
          <div className="vc-memory-diary__entry">
            {activeEntry.title ? (
              <h4 className="vc-memory-diary__entry-title">{activeEntry.title}</h4>
            ) : null}
            <p className="vc-memory-diary__entry-body">
              {activeEntry.body ?? activeEntry.content ?? ''}
            </p>
            {moments.length > 0 ? (
              <div className="vc-memory-diary__moments">
                <strong>{DIARY_MOMENTS}</strong>
                <ul>
                  {moments.map((moment, idx) => (
                    <li key={idx}>{moment}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
