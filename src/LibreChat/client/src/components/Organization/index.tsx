import { useState } from 'react';
import { Button, Input } from '@librechat/client';
import { organizationPaths } from 'librechat-data-provider';
import { useOrganization } from './queries';
import { useLocalize } from '~/hooks';
import Fields from './Fields';
import ApiKeys from './ApiKeys';

export default function Organization() {
  const localize = useLocalize();
  const { status, members, connections, mutation } = useOrganization(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [alias, setAlias] = useState('');
  const [provider, setProvider] = useState('oidc');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const submit = async (path: string, method: string, body?: object) => {
    setSaved(false);
    try {
      await mutation.mutateAsync({ path, method, body });
      setPassword('');
      if (path === organizationPaths.connections) setSettings({});
      setSaved(true);
    } catch {
      /* The mutation error is rendered without provider diagnostics. */
    }
  };
  if (status.isLoading)
    return (
      <p role="status" className="p-6">
        {localize('com_org_loading')}
      </p>
    );
  if (status.isError)
    return (
      <p role="alert" className="p-6">
        {localize('com_org_error')}
      </p>
    );
  if (!status.data?.enabled) return <p className="p-6">{localize('com_org_disabled')}</p>;
  const owner = status.data.role === 'owner';
  const manager = owner || status.data.role === 'admin';
  const selectStyle =
    'rounded-lg border border-border-light bg-surface-primary p-2 text-text-primary';
  return (
    <main className="text-text-primary mx-auto w-full max-w-4xl space-y-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold">{localize('com_org_title')}</h1>
        <p className="mt-2">
          {status.data.name} · {status.data.role}
        </p>
        <a className="underline" href={status.data.accountURL} target="_blank" rel="noreferrer">
          {localize('com_org_account')}
        </a>
      </header>
      {(mutation.isError || members.isError || connections.isError) && (
        <p role="alert">{localize('com_org_error')}</p>
      )}
      {saved && <p role="status">{localize('com_org_saved')}</p>}
      {status.data.bootstrap && (
        <section className="border-border-light space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{localize('com_org_connect')}</h2>
          <p>{localize('com_org_connect_help')}</p>
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(organizationPaths.identity, 'POST', { password });
            }}
          >
            <Input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
              aria-label={localize('com_org_password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" disabled={mutation.isLoading}>
              {localize('com_org_connect')}
            </Button>
          </form>
        </section>
      )}
      {manager && <ApiKeys />}
      {manager && (
        <section className="border-border-light space-y-4 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{localize('com_org_members')}</h2>
          {members.isLoading && <p role="status">{localize('com_org_loading')}</p>}
          <ul className="divide-border-light divide-y">
            {members.data?.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 break-all">{member.email}</span>
                {owner && member.role !== 'owner' ? (
                  <select
                    aria-label={`${localize('com_org_role')} ${member.email}`}
                    value={member.role}
                    disabled={mutation.isLoading}
                    className={selectStyle}
                    onChange={(e) => {
                      void submit(
                        `${organizationPaths.members}/${encodeURIComponent(member.id)}`,
                        'PATCH',
                        { role: e.target.value },
                      );
                    }}
                  >
                    {member.role === 'pending' && (
                      <option value="pending">{localize('com_org_pending')}</option>
                    )}
                    <option value="user">{localize('com_org_user')}</option>
                    <option value="admin">{localize('com_org_admin')}</option>
                    <option value="owner">{localize('com_org_owner')}</option>
                  </select>
                ) : (
                  <span>{member.role}</span>
                )}
                {member.role !== 'owner' && (owner || member.role === 'user') && (
                  <Button
                    variant="outline"
                    disabled={mutation.isLoading}
                    onClick={() => {
                      void submit(
                        `${organizationPaths.members}/${encodeURIComponent(member.id)}`,
                        'PATCH',
                        { enabled: !member.enabled },
                      );
                    }}
                  >
                    {localize(member.enabled ? 'com_org_disable' : 'com_org_enable')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!members.isLoading && !members.data?.length && <p>{localize('com_org_empty')}</p>}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(organizationPaths.members, 'POST', { email, password, role });
            }}
          >
            <h3 className="font-semibold">{localize('com_org_add')}</h3>
            <p>{localize('com_org_temporary')}</p>
            <Input
              type="email"
              required
              aria-label={localize('com_org_email')}
              placeholder={localize('com_org_email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              type="password"
              required
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
              aria-label={localize('com_org_password')}
              placeholder={localize('com_org_password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <select
              className={selectStyle}
              value={role}
              aria-label={localize('com_org_role')}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="user">{localize('com_org_user')}</option>
              {owner && <option value="admin">{localize('com_org_admin')}</option>}
            </select>
            <Button type="submit" disabled={mutation.isLoading}>
              {localize('com_org_add')}
            </Button>
          </form>
        </section>
      )}
      {owner && (
        <section className="border-border-light space-y-4 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{localize('com_org_sso')}</h2>
          <p>{localize('com_org_sso_help')}</p>
          <ul>
            {connections.data?.map((connection) => (
              <li className="flex items-center gap-3 py-2" key={connection.alias}>
                <span className="flex-1">
                  {connection.alias} · {connection.providerId}
                </span>
                <Button
                  variant="outline"
                  disabled={mutation.isLoading}
                  onClick={() => {
                    void submit(
                      `${organizationPaths.connections}/${encodeURIComponent(connection.alias)}`,
                      'DELETE',
                    );
                  }}
                >
                  {localize('com_org_remove')}
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(organizationPaths.connections, 'POST', {
                alias,
                providerId: provider,
                config: { ...settings, defaultScope: 'openid profile email' },
              });
            }}
          >
            <Input
              aria-label={localize('com_org_alias')}
              placeholder={localize('com_org_alias')}
              required
              pattern="[a-z0-9-]{1,50}"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
            <select
              className={selectStyle}
              value={provider}
              aria-label={localize('com_org_protocol')}
              onChange={(e) => {
                setProvider(e.target.value);
                setSettings({});
              }}
            >
              <option value="oidc">OIDC</option>
              <option value="saml">SAML</option>
            </select>
            <Fields provider={provider} settings={settings} onChange={setSettings} />
            <Button type="submit" disabled={mutation.isLoading}>
              {localize('com_org_sso_add')}
            </Button>
          </form>
        </section>
      )}
    </main>
  );
}
