import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DayLog, PersonId, ReviewSnapshot, ViewSubject } from '../../shared/contracts';
import { PERSON_LABEL } from '../../shared/contracts';
import { averageKnown } from '../../shared/calculations';
import { DayViewSwitch } from './DayViewSwitch';
import { getReview } from './api';
import { ActivityIcon, CalendarIcon, ChevronIcon, DumbbellIcon, EditIcon, MealIcon, ScaleIcon } from './icons';

const people: PersonId[] = ['zhuzhu', 'xiaohua'];
const mealLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' } as const;

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function visiblePeople(view: ViewSubject): PersonId[] { return view === 'shared' ? people : [view]; }

export function summarizeReview(snapshot: ReviewSnapshot, visible: PersonId[]) {
  let meals = 0; let sets = 0; let cardio = 0; let measurements = 0;
  for (const day of snapshot.days) for (const person of visible) {
    const log = day.logs[person]; meals += log.meals.length; sets += log.sets.length; cardio += log.cardio.length; measurements += log.measurements.length;
  }
  return { meals, sets, cardio, measurements };
}

const statusLabel = { partial: '部分记录', complete: '完整记录' } as const;

export function describeDay(log: DayLog): string[] {
  const values: string[] = [];
  const training = [log.sets.length ? `力量 ${log.sets.length} 组` : '', log.cardio.length ? `有氧 ${log.cardio.length} 次` : ''].filter(Boolean);
  if (log.training_status !== 'unlogged' || training.length) values.push(`训练${log.training_status === 'unlogged' ? '' : ` ${statusLabel[log.training_status]}`}${training.length ? ` · ${training.join(' · ')}` : ''}`);
  if (log.nutrition_status !== 'unlogged' || log.meals.length) values.push(`餐食${log.nutrition_status === 'unlogged' ? '' : ` ${statusLabel[log.nutrition_status]}`}${log.meals.length ? ` · ${log.meals.length} 笔` : ''}`);
  if (log.measurements.length) values.push(`测量 ${log.measurements.length} 次`);
  return values;
}

type WeightPoint = { person: PersonId; date: string; value: number; unit: string };
export function reviewWeightPoints(snapshot: ReviewSnapshot, visible: PersonId[]): { points: WeightPoint[]; unit: string | null; mixedUnits: boolean } {
  const points: WeightPoint[] = [];
  for (const day of snapshot.days) for (const person of visible) {
    const weights = day.logs[person].measurements.filter((entry) => entry.metric === 'weight');
    const latest = [...weights].sort((a, b) => (a.measured_at ?? a.source.recorded_at).localeCompare(b.measured_at ?? b.source.recorded_at)).at(-1);
    if (latest) points.push({ person, date: day.date, value: latest.value, unit: latest.unit });
  }
  const units = [...new Set(points.map((point) => point.unit))];
  return { points, unit: units.length === 1 ? units[0] : null, mixedUnits: units.length > 1 };
}

export function reviewWeightSummaries(snapshot: ReviewSnapshot, visible: PersonId[]) {
  const { points } = reviewWeightPoints(snapshot, visible);
  return visible.map((person) => {
    const series = points.filter((point) => point.person === person); const units = [...new Set(series.map((point) => point.unit))];
    const unit = units.length === 1 ? units[0] : null; const { average } = averageKnown(unit ? series.map((point) => point.value) : []);
    return { person, samples: series.length, average, unit, mixedUnits: units.length > 1 };
  });
}

const formatNumber = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

function SummaryItem({ icon, label, value, unit, tone }: { icon: ReactNode; label: string; value: number; unit: string; tone: string }) {
  return <div className={`review-summary-item ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}<em>{unit}</em></strong></div></div>;
}

function WeightChart({ snapshot, visible }: { snapshot: ReviewSnapshot; visible: PersonId[] }) {
  const { points, unit, mixedUnits } = reviewWeightPoints(snapshot, visible);
  const summaries = reviewWeightSummaries(snapshot, visible);
  const header = <div className="review-panel-head"><div><h2>体重记录</h2><p>每天取最后一条有效记录</p></div><div className="weight-legend">{summaries.map((summary) => <span className={summary.person} key={summary.person}><i />{PERSON_LABEL[summary.person]} · {summary.samples} 天{summary.average !== null && summary.unit ? ` · 平均 ${formatNumber(summary.average)} ${summary.unit}` : summary.mixedUnits ? ' · 单位不一' : ''}</span>)}</div></div>;
  if (!points.length) return <section className="review-panel weight-panel">{header}<p className="review-muted">最近 7 天暂无体重记录。</p></section>;
  if (mixedUnits) return <section className="review-panel weight-panel">{header}<p className="review-muted">单位不一致，暂不绘制趋势。</p></section>;
  if (!unit || !summaries.some((summary) => summary.samples >= 2)) return <section className="review-panel weight-panel">{header}<p className="review-muted">同一人物至少 2 次同单位记录后显示趋势。</p></section>;
  const values = points.map((point) => point.value); const low = Math.min(...values); const high = Math.max(...values); const pad = high === low ? 1 : (high - low) * .2;
  const min = low - pad; const max = high + pad; const x = (date: string) => 48 + snapshot.days.findIndex((day) => day.date === date) / 6 * 524; const y = (value: number) => 168 - (value - min) / (max - min) * 112;
  return <section className="review-panel weight-panel">
    {header}
    <svg className="weight-chart" viewBox="0 0 620 220" role="img" aria-label={`体重记录趋势，单位 ${unit}`}>
      {[0, .5, 1].map((part) => <line key={part} x1="42" x2="582" y1={56 + part * 112} y2={56 + part * 112} className="chart-grid" />)}
      {visible.map((person) => { const series = points.filter((point) => point.person === person); return <g className={person} key={person}>
        {series.length > 1 ? <path d={series.map((point, index) => `${index ? 'L' : 'M'} ${x(point.date)} ${y(point.value)}`).join(' ')} className="chart-line" /> : null}
        {series.map((point) => <g key={`${person}-${point.date}`}><circle cx={x(point.date)} cy={y(point.value)} r="5" /><text x={x(point.date)} y={y(point.value) - 11} textAnchor="middle">{formatNumber(point.value)}</text></g>)}
      </g>; })}
      {[snapshot.start, snapshot.days[3].date, snapshot.end].map((date) => <text className="chart-date" x={x(date)} y="205" textAnchor="middle" key={date}>{shortDate(date)}</text>)}
    </svg>
    <small className="chart-note">仅显示有记录的日期与数值</small>
  </section>;
}

type Activity = { id: string; person: PersonId; date: string; at: string; kind: 'training' | 'cardio' | 'meal'; detail: string };
function recentActivities(snapshot: ReviewSnapshot, visible: PersonId[]): Activity[] {
  const values: Activity[] = [];
  for (const day of snapshot.days) for (const person of visible) {
    const log = day.logs[person]; const exercises = new Map((day.plan?.people[person].training.exercises ?? []).map((exercise) => [exercise.exercise_id, exercise.name]));
    const groups = new Map<string, typeof log.sets>();
    for (const set of log.sets) groups.set(set.exercise_id, [...(groups.get(set.exercise_id) ?? []), set]);
    for (const [exerciseId, sets] of groups) { const last = sets.at(-1)!; values.push({ id: `${day.date}-${person}-sets-${exerciseId}`, person, date: day.date, at: last.source.recorded_at, kind: 'training', detail: `${exercises.get(exerciseId) ?? exerciseId} · ${sets.length} 组` }); }
    for (const item of log.cardio) values.push({ id: `${day.date}-${person}-cardio-${item.id}`, person, date: day.date, at: item.occurred_at ?? item.source.recorded_at, kind: 'cardio', detail: [item.activity, item.duration_minutes === null ? null : `${item.duration_minutes} 分钟`].filter(Boolean).join(' · ') });
    for (const item of log.meals) values.push({ id: `${day.date}-${person}-meal-${item.id}`, person, date: day.date, at: item.occurred_at ?? item.source.recorded_at, kind: 'meal', detail: `${mealLabel[item.meal]} · ${item.items.map((food) => food.name).join('、') || '内容待补充'}` });
  }
  return values.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}

function ActivityFeed({ snapshot, visible }: { snapshot: ReviewSnapshot; visible: PersonId[] }) {
  const activities = recentActivities(snapshot, visible);
  return <section className="review-panel activity-panel"><h2>训练与饮食</h2>{activities.length ? <div className="review-activity-list">{activities.map((item) => <div className="review-activity" key={item.id}>
    <span className={`activity-icon ${item.kind}`}>{item.kind === 'meal' ? <MealIcon /> : item.kind === 'cardio' ? <ActivityIcon /> : <DumbbellIcon />}</span>
    <strong>{item.kind === 'meal' ? '餐食记录' : item.kind === 'cardio' ? '有氧运动' : '力量训练'}</strong><small>{PERSON_LABEL[item.person]} · {shortDate(item.date)}</small><p>{item.detail}</p>
  </div>)}</div> : <p className="review-muted">这 7 天暂无训练或餐食记录。</p>}</section>;
}

export function ReviewPage({ today, initialEnd, onShowDay, onAskAgent }: { today: string; initialEnd: string; onShowDay: (date: string) => void; onAskAgent: (text: string) => void }) {
  const [end, setEnd] = useState(initialEnd); const [view, setView] = useState<ViewSubject>('shared'); const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; setError(''); setSnapshot(null); getReview(end).then((value) => { if (active) setSnapshot(value); }).catch((reason) => { if (active) setError(reason.message); }); return () => { active = false; }; }, [end]);
  const visible = useMemo(() => visiblePeople(view), [view]); const summary = snapshot ? summarizeReview(snapshot, visible) : null; const subject = view === 'shared' ? '珠珠和小花' : PERSON_LABEL[view];
  const range = snapshot ? `${shortDate(snapshot.start)}—${shortDate(snapshot.end)}` : `${shortDate(shiftDate(end, -6))}—${shortDate(end)}`;
  return <main className="review-page">
    <header className="review-head"><div><h1>最近 7 天</h1><label className="review-range"><CalendarIcon /><span>{range}</span><input aria-label="选择回顾截止日期" type="date" max={today} value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>
      <div className="review-head-controls"><div className="week-buttons"><button type="button" aria-label="上一周" onClick={() => setEnd(shiftDate(end, -7))}><ChevronIcon />上一周</button><button type="button" aria-label="下一周" disabled={end >= today} onClick={() => setEnd(shiftDate(end, 7) > today ? today : shiftDate(end, 7))}>下一周<ChevronIcon /></button></div>
        <DayViewSwitch mode="review" onSelect={(mode) => { if (mode === 'day') onShowDay(end); }} />
        <div className="review-person-filter" role="group" aria-label="查看人物">{(['shared', ...people] as ViewSubject[]).map((person) => <button type="button" className={view === person ? 'active' : person} aria-pressed={view === person} onClick={() => setView(person)} key={person}>{person === 'shared' ? '两人' : PERSON_LABEL[person]}</button>)}</div>
      </div>
    </header>
    {error ? <p className="inline-error" role="alert">{error}</p> : !snapshot || !summary ? <div className="loading-line">正在整理这 7 天…</div> : <>
      <section className="review-summary" aria-label="已记录内容摘要"><SummaryItem icon={<MealIcon />} label="餐食" value={summary.meals} unit="笔" tone="meal"/><SummaryItem icon={<DumbbellIcon />} label="力量" value={summary.sets} unit="组" tone="training"/><SummaryItem icon={<ActivityIcon />} label="有氧" value={summary.cardio} unit="次" tone="cardio"/><SummaryItem icon={<ScaleIcon />} label="测量" value={summary.measurements} unit="次" tone="measure"/><small>只统计已记录内容</small></section>
      <section className="review-days" aria-label="7 天记录"><div className={`review-day review-day-head people-${visible.length}`}><span>日期</span>{visible.map((person) => <strong className={person} key={person}>{PERSON_LABEL[person]}</strong>)}</div>{snapshot.days.map((day) => <button type="button" className={`review-day people-${visible.length}`} onClick={() => onShowDay(day.date)} key={day.date}><span className="review-day-date"><strong>{shortDate(day.date)}</strong><small>{weekday(day.date)}</small></span>{visible.map((person) => { const details = describeDay(day.logs[person]); return <span className={`review-day-person ${person}`} key={person}>{details.length ? details.map((detail) => <i key={detail}>{detail}</i>) : <em>暂无记录</em>}</span>; })}</button>)}</section>
      <div className="review-lower"><WeightChart snapshot={snapshot} visible={visible}/><ActivityFeed snapshot={snapshot} visible={visible}/></div>
      <footer className="review-actions"><button type="button" className="primary-action" onClick={() => onAskAgent(`请回顾 ${snapshot.start} 至 ${snapshot.end} ${subject}的记录。请区分未记录、部分记录和完整记录，不把缺失当作 0；先总结已记录的事实，再给最多 3 条下一步建议。`)}><EditIcon />让饲养员复盘这 7 天</button><button type="button" className="secondary-action" onClick={() => onAskAgent(`请为${subject}安排 ${shiftDate(snapshot.end, 1)} 至 ${shiftDate(snapshot.end, 7)} 的饮食和训练计划。`)}><CalendarIcon />安排下一周</button></footer>
    </>}
  </main>;
}
