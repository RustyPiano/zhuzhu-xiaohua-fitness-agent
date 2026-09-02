import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { DayLog, DayPlan, DaySnapshot, ExercisePlan, MealItem, MeasurementLog, NutritionValue, PersonId, SetLog, ViewSubject } from '../../shared/contracts';
import { PERSON_LABEL } from '../../shared/contracts';
import { summarizeNutrition } from '../../shared/calculations';
import { getDay } from './api';
import { CalendarIcon, ChevronIcon, DumbbellIcon, EditIcon, MealIcon, ScaleIcon } from './icons';

const people: PersonId[] = ['zhuzhu', 'xiaohua'];
const mealLabel = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
const mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const statusScore = { unlogged: 0, partial: 0.5, complete: 1 } as const;
const measurementLabel: Record<MeasurementLog['metric'], string> = { weight: '体重', waist: '腰围', body_fat: '体脂率', other: '其他' };
const measurementNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function setText(set: SetLog): string {
  const load = set.load === null ? '负重待补充' : `${set.load} ${set.load_unit ?? ''}`.trim();
  return `${load} × ${set.reps ?? '次数待补充'}${set.side && set.side !== 'both' ? ` · ${set.side === 'left' ? '左' : '右'}` : ''}`;
}

function itemAmount(item: MealItem): string {
  return item.amount === null ? '份量待补充' : `${item.amount} ${item.unit ?? ''}`.trim();
}

function SectionHeading({ icon, title, meta }: { icon: ReactNode; title: string; meta?: string | null }) {
  return <header className="section-heading"><span className="section-icon">{icon}</span><h2>{title}</h2>{meta ? <span className="section-meta">{meta}</span> : null}</header>;
}

function Vitality({ person, log, pressed, dimmed, onSelect }: { person: PersonId; log: DayLog; pressed: boolean; dimmed: boolean; onSelect: () => void }) {
  const score = (statusScore[log.training_status] + statusScore[log.nutrition_status]) / 2;
  const deg = Math.round(score * 360);
  const ring = { background: `conic-gradient(var(--${person}) ${deg}deg, var(--ring-track) ${deg}deg 360deg)` } as CSSProperties;
  const state = score === 0 ? '还没开始' : score < 1 ? '进行中' : '今天齐了';
  return <button type="button" className={`vitality ${person}${pressed ? ' pressed' : ''}${dimmed ? ' dimmed' : ''}`} aria-pressed={pressed} onClick={onSelect}>
    <span className="vitality-ring" style={ring}><span className="vitality-core">{PERSON_LABEL[person].slice(0, 1)}</span></span>
    <span className="vitality-text"><strong>{PERSON_LABEL[person]}</strong><small>{state}</small></span>
  </button>;
}

function Meter({ person, exercise, plan, log }: { person: PersonId; exercise: ExercisePlan; plan: DayPlan | null; log: DayLog }) {
  const target = plan?.people[person].training.exercises.find((item) => item.exercise_id === exercise.exercise_id);
  const doneSets = log.sets.filter((set) => set.exercise_id === exercise.exercise_id && set.kind === 'work');
  const done = doneSets.length;
  const planned = target?.sets ?? null;
  const last = doneSets[doneSets.length - 1];
  const pipCount = Math.min(20, Math.max(planned ?? 0, done));
  const filled = Math.min(done, pipCount);
  const load = target?.load != null ? `${target.load} ${target.load_unit ?? ''}`.trim() : last?.load != null ? `${last.load} ${last.load_unit ?? ''}`.trim() : '负重待补充';
  const reps = target?.reps ?? (last?.reps != null ? `${last.reps}` : null);
  const count = planned != null ? `${done}/${planned} 组` : done ? `${done} 组` : '未记录';
  return <span className={`ex-meter ${person}`}>
    <span className="ex-meter-who">{PERSON_LABEL[person]}</span>
    {pipCount > 0
      ? <span className="pips" aria-hidden="true">{Array.from({ length: pipCount }, (_, index) => <i key={index} className={index < filled ? 'pip done' : 'pip'} />)}</span>
      : <span className="pips-none" aria-hidden="true">待安排</span>}
    <span className="ex-meter-num">{count}{reps ? ` · ${reps}` : ''} · {load}</span>
  </span>;
}

function Training({ snapshot, visible }: { snapshot: DaySnapshot; visible: PersonId[] }) {
  const plan = snapshot.plan;
  const exercises = new Map<string, ExercisePlan>();
  const cardio = visible.map((person) => ({ person, text: plan?.people[person].training.cardio })).filter((item): item is { person: PersonId; text: string } => typeof item.text === 'string' && item.text.trim().length > 0);
  for (const person of visible) for (const exercise of plan?.people[person].training.exercises ?? []) if (!exercises.has(exercise.exercise_id)) exercises.set(exercise.exercise_id, exercise);
  for (const person of visible) for (const set of snapshot.logs[person].sets) if (!exercises.has(set.exercise_id)) exercises.set(set.exercise_id, { exercise_id: set.exercise_id, name: set.exercise_id, equipment: set.equipment, sets: null, reps: null, load: null, load_unit: null, rest_seconds: null, notes: [] });
  if (!exercises.size && !cardio.length) return <EmptyBlock icon={<DumbbellIcon />} title="今天还没安排训练" text="去告诉饲养员，帮你排一次。" />;
  return <section className="activity-section">
    <SectionHeading icon={<DumbbellIcon />} title="训练" meta={plan?.title} />
    {cardio.length ? <div className="cardio-plan" aria-label="有氧训练计划">{cardio.map(({ person, text }) => <div className={`cardio-plan-item ${person}`} key={person}><strong>{PERSON_LABEL[person]} · 有氧</strong><p>{text}</p></div>)}</div> : null}
    {exercises.size ? <div className="ex-list">
      {[...exercises.values()].map((exercise) => <details className="ex-row" key={exercise.exercise_id}>
        <summary className="ex-summary">
          <span className="ex-name"><strong>{exercise.name}</strong><small>{exercise.equipment ?? '器械待补充'}</small></span>
          <span className="ex-meters">{visible.map((person) => <Meter key={person} person={person} exercise={exercise} plan={plan} log={snapshot.logs[person]} />)}</span>
          <ChevronIcon className="row-chevron" />
        </summary>
        <div className="ex-notes">
          <div className="ex-notes-head">动作备注</div>
          {exercise.notes.length ? <ul>{exercise.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>暂无备注</p>}
          <p className="ex-rest">{exercise.rest_seconds ? `组间休息 ${exercise.rest_seconds} 秒` : '休息时长待补充'}</p>
          {visible.flatMap((person) => snapshot.logs[person].sets.filter((set) => set.exercise_id === exercise.exercise_id).map((set) => <p className="ex-logged" key={`${person}-${set.id}`}><b className={person}>{PERSON_LABEL[person]}</b>{setText(set)}</p>))}
        </div>
      </details>)}
    </div> : null}
  </section>;
}

function NutritionCard({ person, plan, log }: { person: PersonId; plan: DayPlan | null; log: DayLog }) {
  const summary = summarizeNutrition(log);
  const kcal = summary.nutrients.kcal;
  const protein = summary.nutrients.protein_g;
  const target = plan?.people[person].nutrition.targets.kcal ?? null;
  const value = (entry: typeof kcal, unit: string) => entry.known_total === null ? '待补充' : `${entry.unknown_items ? '至少 ' : ''}${Math.round(entry.known_total)} ${unit}`;
  const known = kcal.known_total;
  const pct = target && known !== null ? Math.min(100, Math.round((known / target) * 100)) : null;
  return <div className={`nutrition-card ${person}`}>
    <div className="nc-head"><strong>{PERSON_LABEL[person]}</strong>{target ? <span className="nc-target">目标 {Math.round(target)} 千卡</span> : <span className="nc-target muted">目标未设定</span>}</div>
    <div className="nc-value">{summary.logged_items ? value(kcal, '千卡') : '还没记录'}{summary.logged_items ? <small>蛋白质 {value(protein, 'g')}</small> : null}</div>
    {pct !== null
      ? <div className="nc-bar"><i style={{ width: `${pct}%` }} /></div>
      : <div className="nc-bar none">{summary.logged_items && known === null ? '数值待补充' : '未设定目标'}</div>}
    {kcal.unknown_items ? <em className="nc-est">含估算或缺失项</em> : null}
  </div>;
}

function Meals({ plan, logs, visible }: { plan: DayPlan | null; logs: Record<PersonId, DayLog>; visible: PersonId[] }) {
  const kinds = mealOrder.filter((kind) => visible.some((person) => plan?.people[person].nutrition.meals.some((meal) => meal.meal === kind) || logs[person].meals.some((meal) => meal.meal === kind)));
  if (!kinds.length) return <EmptyBlock icon={<MealIcon />} title="今天还没安排饮食" text="吃完记一笔，或让饲养员帮你排。" />;
  return <section className="activity-section">
    <SectionHeading icon={<MealIcon />} title="饮食" />
    <div className="nutrition-board">{visible.map((person) => <NutritionCard key={person} person={person} plan={plan} log={logs[person]} />)}</div>
    <div className="meal-timeline">
      {kinds.map((kind) => <div className="meal-block" key={kind}>
        <span className="meal-kind">{mealLabel[kind]}</span>
        <div className="meal-people">
          {visible.map((person) => {
            const logged = logs[person].meals.filter((meal) => meal.meal === kind).flatMap((meal) => meal.items);
            const planned = plan?.people[person].nutrition.meals.find((meal) => meal.meal === kind)?.items ?? [];
            if (!logged.length && !planned.length) return null;
            const items = logged.length ? logged : planned;
            return <div className={`meal-person ${person}`} key={person}>
              <span className="meal-who">{PERSON_LABEL[person]}</span>
              <span className="meal-chips">{items.map((item) => <b className={logged.length ? 'chip logged' : 'chip planned'} key={item.id}>{item.name}<small>{itemAmount(item)}</small></b>)}</span>
              <span className="meal-state">{logged.length ? '已记' : '待记录'}</span>
            </div>;
          })}
        </div>
      </div>)}
    </div>
  </section>;
}

function Measurements({ logs, visible }: { logs: Record<PersonId, DayLog>; visible: PersonId[] }) {
  const entries = visible.flatMap((person) => logs[person].measurements.map((measurement) => ({ person, measurement })));
  if (!entries.length) return <EmptyBlock icon={<ScaleIcon />} title="这一天还没记录身体指标" text="体重、腰围和体脂都可以交给饲养员记录。" />;
  return <section className="activity-section">
    <SectionHeading icon={<ScaleIcon />} title="身体指标" />
    <div className="measurement-board">
      {entries.map(({ person, measurement }) => <article className={`measurement-card ${person}`} key={`${person}-${measurement.id}`}>
        <div className="measurement-head"><strong>{PERSON_LABEL[person]}</strong><span>{measurementLabel[measurement.metric]}</span></div>
        <div className="measurement-value">{measurementNumber.format(measurement.value)} <small>{measurement.unit}</small></div>
        {measurement.measured_at ? <time>{new Date(measurement.measured_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time> : null}
        {measurement.notes.length ? <p>{measurement.notes.join(' · ')}</p> : null}
      </article>)}
    </div>
  </section>;
}

function EmptyBlock({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <section className="empty-block"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{text}</p></section>;
}

export function TodayPage({ initialDate, onAskAgent }: { initialDate: string; onAskAgent: (text: string) => void }) {
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<ViewSubject>('shared');
  const [snapshot, setSnapshot] = useState<DaySnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; setError(''); getDay(date).then((value) => { if (active) setSnapshot(value); }).catch((reason) => { if (active) setError(reason.message); }); return () => { active = false; }; }, [date]);
  useEffect(() => { const refresh = () => void getDay(date).then(setSnapshot).catch(() => {}); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [date]);
  const visible = useMemo<PersonId[]>(() => view === 'shared' ? people : [view], [view]);
  const stamp = new Date(`${date}T12:00:00`);
  const monthDay = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(stamp);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(stamp);
  return <main className="today-page">
    <div className="board-head">
      <div className="board-date">
        <span className="board-eyebrow">{date === initialDate ? '今天' : '回看这一天'}</span>
        <h1>{monthDay}</h1>
        <label className="date-control"><CalendarIcon /><span>{weekday} · 换一天</span><input aria-label="选择日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      <div className="vitality-marks" role="group" aria-label="查看人物">
        {snapshot ? people.map((person) => <Vitality key={person} person={person} log={snapshot.logs[person]} pressed={view === person} dimmed={view !== 'shared' && view !== person} onSelect={() => setView(person)} />) : null}
        <button type="button" className={`vitality-both${view === 'shared' ? ' pressed' : ''}`} aria-pressed={view === 'shared'} onClick={() => setView('shared')}>两人一起</button>
      </div>
    </div>
    {error
      ? <p className="inline-error" role="alert">{error}</p>
      : snapshot
        ? <div className="day-content"><Measurements logs={snapshot.logs} visible={visible} /><Training snapshot={snapshot} visible={visible} /><Meals plan={snapshot.plan} logs={snapshot.logs} visible={visible} /></div>
        : <div className="loading-line">正在打开这一天…</div>}
    <footer className="today-footer"><button type="button" className="primary-action" onClick={() => onAskAgent(`请帮我记录 ${date} 的情况。`)}><EditIcon />交给饲养员记一笔</button></footer>
  </main>;
}
