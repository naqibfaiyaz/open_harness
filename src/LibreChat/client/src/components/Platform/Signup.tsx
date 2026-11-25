import { useEffect, useState } from 'react';
import { Button, Input } from '@librechat/client';
import { signupPaths } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useSignup } from './signupQueries';
import { useLocalize } from '~/hooks';

export default function Signup() {
  const localize = useLocalize();
  const { config, status, mutation } = useSignup();
  const [token, setToken] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    return value;
  });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const state = status.data?.status;
  const act = async (path: string, body: object) => {
    try {
      await mutation.mutateAsync({ path, body });
      if (path === signupPaths.start) setSent(true);
      if (path === signupPaths.verify) setToken('');
      if (path === signupPaths.create) setPassword('');
    } catch {
      /* The server returns only approved error codes. */
    }
  };
  const errors: Record<string, TranslationKeys> = {
    ORGANIZATION_CAPACITY: 'com_signup_capacity',
    ORGANIZATION_EXISTS: 'com_signup_exists',
    INVALID_ORGANIZATION: 'com_signup_slug_hint',
    SIGNUP_LINK_INVALID: 'com_signup_link_invalid',
    SIGNUP_RATE_LIMIT: 'com_signup_rate',
    SIGNUP_EMAIL_UNAVAILABLE: 'com_signup_mail_error',
    SIGNUP_SESSION_REQUIRED: 'com_signup_session',
    INVALID_INPUT: 'com_signup_invalid',
  };
  const error = mutation.error instanceof Error ? mutation.error.message : '';
  const content = () => {
    if (config.isLoading) return <p role="status">{localize('com_platform_loading')}</p>;
    if (!config.data?.enabled) return <p role="status">{localize('com_signup_unavailable')}</p>;
    if (token)
      return (
        <>
          <Button
            disabled={mutation.isLoading}
            onClick={() => void act(signupPaths.verify, { token })}
          >
            {localize('com_signup_verify')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setToken('');
              mutation.reset();
            }}
          >
            {localize('com_signup_resend')}
          </Button>
        </>
      );
    if (state === 'verified')
      return (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act(signupPaths.create, { name, slug, password });
          }}
        >
          <p>{localize('com_signup_verified', { 0: status.data?.email ?? '' })}</p>
          <label className="flex flex-col gap-2">
            {localize('com_platform_name')}
            <Input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            {localize('com_platform_slug')}
            <Input
              required
              pattern="[a-z][a-z0-9-]{1,22}[a-z0-9]"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              aria-describedby="signup-slug-hint"
            />
          </label>
          <p id="signup-slug-hint" className="text-text-secondary text-sm">
            {localize('com_signup_slug_hint')}
          </p>
          <label className="flex flex-col gap-2">
            {localize('com_signup_password')}
            <Input
              required
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p>{localize('com_signup_owner')}</p>
          <Button type="submit" disabled={mutation.isLoading}>
            {localize('com_signup_create')}
          </Button>
        </form>
      );
    if (state === 'active')
      return (
        <>
          <p role="status">{localize('com_signup_ready')}</p>
          <a className="underline" href={status.data?.origin}>
            {localize('com_signup_open')}
          </a>
          <p>{localize('com_signup_models')}</p>
        </>
      );
    if (state === 'provisioning') return <p role="status">{localize('com_signup_provisioning')}</p>;
    if (state === 'failed' || state === 'suspended')
      return <p role="alert">{localize('com_signup_support')}</p>;
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void act(signupPaths.start, { email });
        }}
      >
        <label className="flex flex-col gap-2">
          {localize('com_org_email')}
          <Input
            required
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={mutation.isLoading}>
          {localize(sent ? 'com_signup_resend' : 'com_signup_send')}
        </Button>
        {sent && <p role="status">{localize('com_signup_sent')}</p>}
      </form>
    );
  };
  return (
    <main className="bg-surface-primary text-text-primary min-h-screen px-4 py-12">
      <section className="border-border-light mx-auto max-w-lg space-y-5 rounded-xl border p-6">
        <h1 className="text-2xl font-semibold">{localize('com_signup_title')}</h1>
        <p>{localize('com_signup_intro')}</p>
        {config.data?.enabled && mutation.isError && (
          <p role="alert">{localize(errors[error] ?? 'com_signup_error')}</p>
        )}
        {content()}
        <a className="block underline" href="./login?redirect=false">
          {localize('com_signup_login')}
        </a>
      </section>
    </main>
  );
}
