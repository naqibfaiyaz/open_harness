import { useState } from 'react';
import { Button, Input } from '@librechat/client';
import { platformPaths } from 'librechat-data-provider';
import { usePlatform } from './queries';
import { useLocalize } from '~/hooks';

export default function Platform() {
  const localize = useLocalize();
  const [selected, setSelected] = useState('');
  const { status, organizations, members, audit, mutation } = usePlatform(true, selected);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = async (path: string, method: string, body: object) => {
    setSaved(false);
    try {
      await mutation.mutateAsync({ path, method, body: { ...body, reason } });
      setPassword('');
      setSaved(true);
    } catch {
      /* Only safe, localized errors are presented. */
    }
  };
  const busy = mutation.isLoading || reason.trim().length < 8;
  const style = 'rounded-lg border border-border-light bg-surface-primary p-2 text-text-primary';
  if (status.isLoading)
    return (
      <p role="status" className="p-6">
        {localize('com_platform_loading')}
      </p>
    );
  if (status.data?.needsMfa)
    return (
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{localize('com_platform_title')}</h1>
        <p>{localize('com_platform_mfa')}</p>
        <a href="/organization" className="underline">
          {localize('com_org_account')}
        </a>
      </main>
    );
  if (!status.data?.canManage)
    return (
      <p role="alert" className="p-6">
        {localize('com_platform_denied')}
      </p>
    );
  return (
    <main className="text-text-primary mx-auto w-full max-w-5xl space-y-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-2xl font-semibold">{localize('com_platform_title')}</h1>
        <p className="mt-2">{localize('com_platform_scope')}</p>
      </header>
      {status.data.recovery && (
        <p role="status" className="border-border-light rounded-lg border p-3">
          {localize('com_platform_recovery')}
        </p>
      )}
      {(status.isError ||
        organizations.isError ||
        members.isError ||
        audit.isError ||
        mutation.isError) && <p role="alert">{localize('com_platform_error')}</p>}
      {saved && <p role="status">{localize('com_org_saved')}</p>}
      <label className="flex flex-col gap-2">
        {localize('com_platform_reason')}
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={8}
          maxLength={300}
          placeholder={localize('com_platform_reason_hint')}
        />
      </label>
      <section className="border-border-light space-y-4 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">{localize('com_platform_organizations')}</h2>
        {organizations.isLoading && <p role="status">{localize('com_platform_loading')}</p>}
        <ul className="divide-border-light divide-y">
          {organizations.data?.map((organization) => (
            <li key={organization.slug} className="space-y-3 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <strong className="flex-1">{organization.name}</strong>
                <span>{organization.status}</span>
                {organization.status === 'active' && (
                  <a
                    className="underline"
                    href={organization.origin}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {localize('com_platform_open')}
                  </a>
                )}
                <Button variant="outline" onClick={() => setSelected(organization.slug)}>
                  {localize('com_org_members')}
                </Button>
                {!organization.existing && organization.status !== 'provisioning' && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        void submit(
                          `${platformPaths.organizations}/${encodeURIComponent(organization.slug)}/${organization.status === 'active' ? 'suspend' : organization.status === 'suspended' ? 'resume' : 'retry'}`,
                          'POST',
                          {},
                        );
                      }}
                    >
                      {localize(
                        organization.status === 'active'
                          ? 'com_platform_suspend'
                          : organization.status === 'suspended'
                            ? 'com_platform_resume'
                            : 'com_platform_retry',
                      )}
                    </Button>
                    {organization.status === 'active' && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void submit(
                            `${platformPaths.organizations}/${encodeURIComponent(organization.slug)}/upgrade`,
                            'POST',
                            {},
                          );
                        }}
                      >
                        {localize('com_platform_upgrade')}
                      </Button>
                    )}
                  </>
                )}
              </div>
              <p className="text-text-secondary text-sm">{organization.origin}</p>
              {organization.errorCode && (
                <p role="alert">
                  {localize('com_platform_failed')} ({organization.errorCode})
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
      {selected && (
        <section className="border-border-light space-y-4 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">
            {localize('com_org_members')} · {selected}
          </h2>
          {members.isLoading && <p role="status">{localize('com_platform_loading')}</p>}
          <ul className="divide-border-light divide-y">
            {members.data?.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex-1 break-all">{member.email}</span>
                {member.role === 'owner' ? (
                  <span>{localize('com_org_owner')}</span>
                ) : (
                  <>
                    <select
                      aria-label={`${localize('com_org_role')} ${member.email}`}
                      className={style}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => {
                        void submit(
                          `${platformPaths.organizations}/${encodeURIComponent(selected)}/members/${encodeURIComponent(member.id)}`,
                          'PATCH',
                          { role: event.target.value },
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
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        void submit(
                          `${platformPaths.organizations}/${encodeURIComponent(selected)}/members/${encodeURIComponent(member.id)}`,
                          'PATCH',
                          { enabled: !member.enabled },
                        );
                      }}
                    >
                      {localize(member.enabled ? 'com_org_disable' : 'com_org_enable')}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="border-border-light space-y-4 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">{localize('com_platform_create')}</h2>
        <p>{localize('com_platform_create_help')}</p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(platformPaths.organizations, 'POST', {
              slug,
              name,
              ownerEmail: email,
              password,
            });
          }}
        >
          <label className="flex flex-col gap-2">
            {localize('com_platform_name')}
            <Input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            {localize('com_platform_slug')}
            <Input
              required
              pattern="[a-z][a-z0-9-]{1,22}[a-z0-9]"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            {localize('com_platform_owner_email')}
            <Input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            {localize('com_platform_owner_password')}
            <Input
              required
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {localize('com_platform_create')}
          </Button>
        </form>
      </section>
      <section className="border-border-light space-y-4 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">{localize('com_platform_audit')}</h2>
        <ul className="space-y-3">
          {audit.data?.map((entry, index) => (
            <li
              className="border-border-light rounded-lg border p-3 text-sm"
              key={`${entry.at}-${index}`}
            >
              <p>
                {entry.at} · {entry.action} · {entry.target} · {entry.outcome}
              </p>
              <p>
                {localize('com_platform_actor')}: {entry.actor}
              </p>
              <p>{entry.reason}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
