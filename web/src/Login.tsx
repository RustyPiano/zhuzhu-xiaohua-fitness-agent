import { useState, type FormEvent } from 'react';
import { api } from './api';

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
    <section className="login-panel" aria-labelledby="login-title">
      <div className="brand-mark"><span>珠珠</span><i>与</i><b>小花</b></div>
      <h1 id="login-title">回到今天</h1>
      <p>两个人的计划、实际记录与长期偏好，清楚地放在一起。</p>
      <form onSubmit={submit}>
        <fieldset className="identity-choice"><legend>登录身份</legend>
          <label className={person === 'zhuzhu' ? 'selected zhuzhu' : ''}><input type="radio" name="person" value="zhuzhu" checked={person === 'zhuzhu'} onChange={() => setPerson('zhuzhu')} />珠珠</label>
          <label className={person === 'xiaohua' ? 'selected xiaohua' : ''}><input type="radio" name="person" value="xiaohua" checked={person === 'xiaohua'} onChange={() => setPerson('xiaohua')} />小花</label>
        </fieldset>
        <label className="field">密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" disabled={busy}>{busy ? '正在登录…' : `以${person === 'zhuzhu' ? '珠珠' : '小花'}身份进入`}</button>
      </form>
      <small>首次使用前请先确认共享约定与数据流。</small>
    </section>
  </main>;
}
