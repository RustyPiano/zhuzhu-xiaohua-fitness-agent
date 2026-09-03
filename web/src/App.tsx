import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Bootstrap } from '../../shared/contracts';
import { PERSON_LABEL } from '../../shared/contracts';
import { ApiError, api, getBootstrap } from './api';
import { Login } from './Login';
import { TodayPage } from './TodayPage';
import { SproutIcon } from './icons';

const AgentPage = lazy(() => import('./AgentPage').then((module) => ({ default: module.AgentPage })));
const ReviewPage = lazy(() => import('./ReviewPage').then((module) => ({ default: module.ReviewPage })));

type Page = 'today' | 'review' | 'agent';
export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null); const [needsLogin, setNeedsLogin] = useState(false); const [fatal, setFatal] = useState('');
  const [page, setPage] = useState<Page>(() => location.hash === '#agent' ? 'agent' : location.hash === '#review' ? 'review' : 'today'); const [agentDraft, setAgentDraft] = useState(''); const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const load = useCallback(async () => { setFatal(''); try { setBootstrap(await getBootstrap()); setNeedsLogin(false); } catch (error) { if (error instanceof ApiError && error.status === 401) setNeedsLogin(true); else setFatal(error instanceof Error ? error.message : '无法启动应用'); } }, []);
  useEffect(() => { void load(); }, [load]);
  function go(next: Page) { setPage(next); history.replaceState(null, '', `#${next}`); }
  async function signOut() { try { await api('/api/logout', { method: 'POST', body: '{}' }); } finally { setBootstrap(null); setNeedsLogin(true); } }
  if (needsLogin) return <Login onDone={() => void load()}/>;
  if (fatal) return <main className="fatal-state"><h1>暂时无法打开</h1><p>{fatal}</p><button onClick={() => void load()}>重试</button></main>;
  if (!bootstrap) return <main className="app-loading">正在打开…</main>;
  const date = selectedDate ?? bootstrap.today; const askAgent = (text: string) => { setAgentDraft(text); go('agent'); }; const showToday = () => { setSelectedDate(bootstrap.today); go('today'); };
  return <div className="app-shell"><header className="topbar"><button className="wordmark" onClick={showToday} aria-label="珠珠与小花 · 回到今天"><SproutIcon className="wordmark-sprout" /><span className="wm-z">珠珠</span><i>与</i><b className="wm-x">小花</b></button><nav aria-label="主要页面"><button className={page !== 'agent' ? 'active' : ''} onClick={showToday}>今天</button><button className={page === 'agent' ? 'active' : ''} onClick={() => go('agent')}>饲养员</button></nav><div className="account-menu"><span className={`account-dot ${bootstrap.actor}`} aria-hidden="true" /><strong>{PERSON_LABEL[bootstrap.actor]}</strong><button onClick={() => void signOut()} disabled={bootstrap.app_version === 'preview'}>退出</button></div></header>
    {page === 'today'
      ? <TodayPage actor={bootstrap.actor} today={bootstrap.today} initialDate={date} onDateChange={setSelectedDate} onShowReview={() => go('review')} onAskAgent={askAgent}/>
      : page === 'review'
        ? <Suspense fallback={<main className="app-loading">正在打开…</main>}><ReviewPage today={bootstrap.today} initialEnd={date} onShowDay={(next) => { setSelectedDate(next); go('today'); }} onAskAgent={askAgent}/></Suspense>
        : <Suspense fallback={<main className="app-loading">正在打开…</main>}><AgentPage bootstrap={bootstrap} initialText={agentDraft} onInitialTextConsumed={() => setAgentDraft('')}/></Suspense>}
  </div>;
}
