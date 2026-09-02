import { useEffect, useMemo, useState } from 'react';
import type { DayLog, DayPlan, DaySnapshot, PersonId, ViewSubject } from '../../shared/contracts';
import { PERSON_LABEL } from '../../shared/contracts';
import { summarizeNutrition } from '../../shared/calculations';
import { getDay } from './api';
import { CalendarIcon, ChevronIcon, DumbbellIcon, MealIcon } from './icons';

const people: PersonId[] = ['zhuzhu', 'xiaohua'];
const mealLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };

function NutritionSummary({ log }: { log: DayLog }) {
  const summary = summarizeNutrition(log); const kcal = summary.nutrients.kcal; const protein = summary.nutrients.protein_g;
  if (!summary.logged_items) return <span className="unlogged">尚未记录</span>;
  const show = (label: string, value: typeof kcal, unit: string) => value.known_total === null ? `${label}未知` : `${label}${value.unknown_items ? '至少' : ''}${Math.round(value.known_total)} ${unit}${value.unknown_items ? `，另 ${value.unknown_items} 项未估算` : ''}`;
  return <span className="known-total">{show('热量', kcal, '千卡')} · {show('蛋白质', protein, 'g')}</span>;
}

function Training({ snapshot, visible }: { snapshot: DaySnapshot; visible: PersonId[] }) {
  const plan = snapshot.plan;
  if (!plan) return <EmptyBlock title="尚未确认训练计划" text="可以到 Agent 中告诉我今天想练什么，计划不会被当作已完成。" />;
  const base = plan.people[visible[0]].training.exercises;
  return <section className="day-section training-section">
    <header><div><DumbbellIcon/><h2>训练</h2></div><span>{plan.title ?? '今日训练'}</span></header>
    <div className="training-head"><span>动作</span>{visible.map((p) => <span key={p} className={p}>{PERSON_LABEL[p]}</span>)}</div>
    <div className="exercise-list">
      {base.map((exercise, index) => <details className="exercise-row" key={exercise.exercise_id} open={index === 0}>
        <summary>
          <span className="order">{String(index + 1).padStart(2, '0')}</span>
          <span className="exercise-name"><strong>{exercise.name}</strong><small>{exercise.equipment ?? '器械未记录'}</small></span>
          {visible.map((person) => {
            const target = plan.people[person].training.exercises.find((item) => item.exercise_id === exercise.exercise_id);
            const actual = snapshot.logs[person].sets.filter((set) => set.exercise_id === exercise.exercise_id);
            return <span className="target" key={person}><strong>{target?.sets ?? '—'} × {target?.reps ?? '—'}</strong><small>{actual.length ? `已记 ${actual.length} 组` : `${target?.load ?? '—'} ${target?.load_unit ?? ''}`}</small></span>;
          })}
          <ChevronIcon className="row-chevron"/>
        </summary>
        <div className="exercise-detail"><div><b>执行要点</b><ul>{exercise.notes.length ? exercise.notes.map((note) => <li key={note}>{note}</li>) : <li>保持动作稳定；负重口径不明时先确认。</li>}</ul></div><div><b>休息与替代</b><p>组间休息 {exercise.rest_seconds ?? '未记录'} 秒。出现疼痛立即停止并改用合适替代动作。</p></div></div>
      </details>)}
    </div>
  </section>;
}

function Meals({ plan, logs, visible }: { plan: DayPlan | null; logs: Record<PersonId, DayLog>; visible: PersonId[] }) {
  if (!plan) return <EmptyBlock title="尚未确认饮食计划" text="未记录不等于没有吃；这里不会用零填补未知摄入。" />;
  const meals = plan.people[visible[0]].nutrition.meals;
  return <section className="day-section meals-section">
    <header><div><MealIcon/><h2>饮食</h2></div><div className="summary-strip">{visible.map((person) => <NutritionSummary key={person} log={logs[person]} />)}</div></header>
    <div className="meal-columns"><span>餐次与安排</span>{visible.map((p) => <span key={p} className={p}>{PERSON_LABEL[p]}</span>)}</div>
    <div className="meal-list">{meals.map((meal) => <div className="meal-row" key={meal.meal}>
      <div className="meal-time"><strong>{mealLabel[meal.meal]}</strong><small>{meal.label}</small></div>
      {visible.map((person) => {
        const value = plan.people[person].nutrition.meals.find((item) => item.meal === meal.meal);
        return <div className="meal-items" key={person}>{value?.items.map((item) => <div key={item.id}><span>{item.name}</span><small>{item.amount ?? '份量未知'} {item.unit ?? ''}</small></div>)}</div>;
      })}
    </div>)}</div>
  </section>;
}

function EmptyBlock({ title, text }: { title: string; text: string }) { return <section className="empty-block"><span className="empty-line"/><h3>{title}</h3><p>{text}</p></section>; }

export function TodayPage({ initialDate, onAskAgent }: { initialDate: string; onAskAgent: (text: string) => void }) {
  const [date, setDate] = useState(initialDate); const [view, setView] = useState<ViewSubject>('shared');
  const [snapshot, setSnapshot] = useState<DaySnapshot | null>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; setError(''); getDay(date).then((value) => { if (active) setSnapshot(value); }).catch((reason) => { if (active) setError(reason.message); }); return () => { active = false; }; }, [date]);
  useEffect(() => { const refresh = () => void getDay(date).then(setSnapshot); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [date]);
  const visible = useMemo<PersonId[]>(() => view === 'shared' ? people : [view], [view]);
  return <main className="today-page">
    <div className="today-toolbar"><div className="date-title"><CalendarIcon/><div><h1>{date === initialDate ? '今天' : date}</h1><label>选择日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div></div>
      <div className="person-tabs" role="group" aria-label="查看人物">{(['zhuzhu', 'xiaohua', 'shared'] as const).map((value) => <button key={value} className={view === value ? `active ${value}` : ''} onClick={() => setView(value)}>{value === 'shared' ? '两人' : PERSON_LABEL[value]}</button>)}</div>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : snapshot ? <div className="day-grid"><Training snapshot={snapshot} visible={visible}/><Meals plan={snapshot.plan} logs={snapshot.logs} visible={visible}/></div> : <div className="loading-line">正在读取已提交快照…</div>}
    <footer className="today-footer"><p>计划与实际记录分开显示；缺失数据不会被当作零。</p><button onClick={() => onAskAgent(`请帮我记录 ${date} 的情况。`)}>去 Agent 记录<ChevronIcon/></button></footer>
  </main>;
}
