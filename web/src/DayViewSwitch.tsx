export function DayViewSwitch({ mode, onSelect }: { mode: 'day' | 'review'; onSelect: (mode: 'day' | 'review') => void }) {
  return <div className="day-view-switch" role="group" aria-label="查看范围">
    <button type="button" className={mode === 'day' ? 'active' : ''} aria-pressed={mode === 'day'} onClick={() => onSelect('day')}>单日</button>
    <button type="button" className={mode === 'review' ? 'active' : ''} aria-pressed={mode === 'review'} onClick={() => onSelect('review')}>近 7 天</button>
  </div>;
}
