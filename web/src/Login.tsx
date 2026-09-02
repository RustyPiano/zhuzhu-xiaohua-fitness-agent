import { useState, type FormEvent } from 'react';
import { api } from './api';
import { SproutIcon } from './icons';

export function Login({ onDone }: { onDone: () => void }) {
  const [person, setPerson] = useState<'zhuzhu' | 'xiaohua'>('zhuzhu');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ person, password }) }); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败'); }
    finally { setBusy(false); }
  }
  return <main className="login-shell">
    <div className="login-wordmark"><SproutIcon className="login-sprout" aria-hidden="true" /><span className="wm-z">珠珠</span><i>与</i><b className="wm-x">小花</b></div>
    <section className="login-panel" aria-labelledby="login-title">
      <div className="brand-mark"><SproutIcon aria-hidden="true" /><span className="wm-z">珠珠</span><i>与</i><b className="wm-x">小花</b></div>
      <h1 id="login-title">回来啦</h1>
      <p>选个名字，接着记今天。</p>
      <form onSubmit={submit}>
        <fieldset className="identity-choice"><legend>你是谁</legend>
          <label className={person === 'zhuzhu' ? 'selected zhuzhu' : 'zhuzhu'}><input type="radio" name="person" value="zhuzhu" checked={person === 'zhuzhu'} onChange={() => setPerson('zhuzhu')} /><span className="id-mark" aria-hidden="true">珠</span><span className="id-name">珠珠</span></label>
          <label className={person === 'xiaohua' ? 'selected xiaohua' : 'xiaohua'}><input type="radio" name="person" value="xiaohua" checked={person === 'xiaohua'} onChange={() => setPerson('xiaohua')} /><span className="id-mark" aria-hidden="true">花</span><span className="id-name">小花</span></label>
        </fieldset>
        <label className="field">密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" disabled={busy}>{busy ? '正在进入…' : '进入'}</button>
      </form>
      <small>只属于你们两个人的照料手账</small>
    </section>
  </main>;
}
