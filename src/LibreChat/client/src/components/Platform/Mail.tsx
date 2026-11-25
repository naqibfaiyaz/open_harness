import { useEffect, useState } from 'react';
import { Button, Input } from '@librechat/client';
import { signupPaths } from 'librechat-data-provider';
import type { SignupMailSettings } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

export default function Mail({
  settings,
  busy,
  onSave,
}: {
  settings?: SignupMailSettings;
  busy: boolean;
  onSave: (path: string, method: string, body: object) => Promise<void>;
}) {
  const localize = useLocalize();
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [sender, setSender] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.requestedEnabled);
    setHost(settings.host);
    setPort(settings.port);
    setSender(settings.sender);
    setUsername(settings.username);
  }, [settings]);
  return (
    <section className="border-border-light space-y-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">{localize('com_signup_mail_title')}</h2>
      <p>{localize('com_signup_mail_hint')}</p>
      <p role="status">
        {localize(settings?.enabled ? 'com_signup_enabled' : 'com_signup_disabled')}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(signupPaths.settings, 'POST', {
            enabled,
            host,
            port,
            sender,
            username,
            password,
          }).then(() => setPassword(''));
        }}
      >
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {localize('com_signup_enable')}
        </label>
        <label className="flex flex-col gap-2">
          {localize('com_signup_smtp_host')}
          <Input required={enabled} value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          {localize('com_signup_smtp_port')}
          <select
            className="border-border-light bg-surface-primary rounded-lg border p-2"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          >
            <option value={587}>{localize('com_signup_starttls')}</option>
            <option value={465}>{localize('com_signup_tls')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          {localize('com_signup_sender')}
          <Input
            required={enabled}
            type="email"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          {localize('com_signup_smtp_user')}
          <Input
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2">
          {localize('com_signup_smtp_password')}
          <Input
            autoComplete="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {settings?.passwordConfigured && <p>{localize('com_signup_secret_saved')}</p>}
        <Button type="submit" disabled={busy || !settings}>
          {localize('com_signup_save')}
        </Button>
      </form>
      <a className="underline" href="/signup">
        {localize('com_signup_view')}
      </a>
    </section>
  );
}
