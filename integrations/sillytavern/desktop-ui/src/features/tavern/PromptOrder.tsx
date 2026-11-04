import React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Switch } from '../../design/components/Switch';
import type { TavernOrderItem } from '../../data/queries/tavern';

export interface PromptOrderProps {
  items: TavernOrderItem[];
  busy: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

interface SortablePromptRowProps {
  item: TavernOrderItem;
  index: number;
  total: number;
  busy: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function SortablePromptRow({
  item,
  index,
  total,
  busy,
  onSelect,
  onToggle,
  onMoveUp,
  onMoveDown,
}: SortablePromptRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: busy,
  });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0) scaleX(${transform.scaleX ?? 1}) scaleY(${transform.scaleY ?? 1})`
      : undefined,
    transition,
    opacity: isDragging ? 0.72 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="vc-tavern-order-row"
      data-dragging={isDragging ? 'true' : undefined}
    >
      <button
        type="button"
        data-vc-light=""
        disabled={busy}
        data-tavern-action="select-item"
        data-tavern-value={item.id}
        onClick={() => onSelect(item.id)}
        {...attributes}
        {...(busy ? {} : listeners)}
      >
        {item.name}
      </button>
      <Switch
        checked={item.enabled}
        disabled={busy}
        aria-label={`${item.name} 启用`}
        onCheckedChange={(checked) => onToggle(item.id, checked)}
      />
      <button
        type="button"
        className="vc-btn vc-btn-gray"
        disabled={busy || index === 0}
        data-tavern-action="prompt-up"
        data-tavern-value={item.id}
        onClick={() => onMoveUp(item.id)}
      >
        上移
      </button>
      <button
        type="button"
        className="vc-btn vc-btn-gray"
        disabled={busy || index === total - 1}
        data-tavern-action="prompt-down"
        data-tavern-value={item.id}
        onClick={() => onMoveDown(item.id)}
      >
        下移
      </button>
    </div>
  );
}

export function PromptOrder({
  items,
  busy,
  onSelect,
  onToggle,
  onMoveUp,
  onMoveDown,
  onReorder,
}: PromptOrderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (busy) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === String(active.id));
    const newIndex = items.findIndex((item) => item.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextIds = arrayMove(items, oldIndex, newIndex).map((item: TavernOrderItem) => item.id);
    onReorder(nextIds);
  };

  return (
    <section className="vc-desk-group" data-tavern-group="order">
      <h2>提示词顺序</h2>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="vc-tavern-order">
            {items.map((item, index) => (
              <SortablePromptRow
                key={item.id}
                item={item}
                index={index}
                total={items.length}
                busy={busy}
                onSelect={onSelect}
                onToggle={onToggle}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
