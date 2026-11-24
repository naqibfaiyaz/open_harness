import { useEffect, useRef, useState } from 'react';
import { Button } from '@librechat/client';
import { useSearchParams } from 'react-router-dom';
import { hermesSections } from 'librechat-data-provider';
import {
  useHermesProfiles,
  useHermesSession,
  useHermesStatus,
  usePublishHermesProfile,
} from './queries';
import { useLocalize } from '~/hooks';

/** Stock Hermes controls, embedded behind LibreChat's auth gate; no second agent definition store. */
export default function HermesWorkspace() {
  const localize = useLocalize();
  const status = useHermesStatus();
  const profiles = useHermesProfiles(status.data?.canManage === true);
  const session = useHermesSession();
  const publish = usePublishHermesProfile();
  const [params, setParams] = useSearchParams();
  const section =
    hermesSections.find((item) => item.path === params.get('section')) ?? hermesSections[0];
  const [profile, setProfile] = useState('default');
  const [ready, setReady] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [activeProfile, setActiveProfile] = useState('default');
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const renew = useRef(session.mutateAsync);
  renew.current = session.mutateAsync;

  useEffect(() => {
    if (!status.data?.canManage) return;
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await renew.current();
        if (!mounted.current) return;
        setReady(true);
        timer = setTimeout(() => void refresh(), result.renewAfterMs);
      } catch {
        if (mounted.current) setReady(false);
      }
    };
    void refresh();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [status.data?.canManage, attempt]);

  useEffect(() => {
    setFrameLoaded(false);
    setFrameError(false);
  }, [section.path, profile, attempt]);
  useEffect(() => {
    // The stock dashboard also has a profile switcher. Publishing must follow its actual scope.
    const timer = setInterval(() => {
      try {
        const current = frame.current?.contentWindow?.location.search;
        if (current !== undefined)
          setActiveProfile(new URLSearchParams(current).get('profile') || profile);
      } catch {
        /* A dashboard-owned OAuth popup may briefly navigate away from this origin. */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [profile]);
  if (status.isLoading)
    return (
      <p role="status" className="p-6">
        {localize('com_hermes_loading')}
      </p>
    );
  if (status.isError)
    return (
      <div role="alert" className="p-6">
        <p>{localize('com_hermes_unavailable')}</p>
        <Button onClick={() => void status.refetch()}>{localize('com_ui_retry')}</Button>
      </div>
    );
  if (!status.data?.canManage) return <p className="p-6">{localize('com_hermes_forbidden')}</p>;

  const src = `${status.data.workspacePath}${section.path}?profile=${encodeURIComponent(profile)}`;
  return (
    <section
      className="bg-surface-primary text-text-primary flex h-full min-h-0 flex-col overflow-auto"
      data-private
    >
      <header className="border-border-light space-y-3 border-b p-4">
        <h1 className="text-lg font-semibold">{localize('com_hermes_workspace')}</h1>
        <p className="text-text-secondary text-sm">{localize('com_hermes_scope')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label>
            {localize('com_hermes_agents')}{' '}
            <select
              value={activeProfile}
              onChange={(event) => {
                setProfile(event.target.value);
                setActiveProfile(event.target.value);
              }}
              className="border-border-light bg-surface-primary rounded border p-2"
            >
              {(profiles.data?.profiles ?? [{ name: 'default' }]).map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            onClick={() => void profiles.refetch()}
            disabled={profiles.isFetching}
          >
            {localize('com_hermes_refresh')}
          </Button>
          <Button onClick={() => publish.mutate(activeProfile)} disabled={publish.isLoading}>
            {localize('com_hermes_publish')}
          </Button>
        </div>
        {profiles.isError && <p role="alert">{localize('com_hermes_unavailable')}</p>}
        {publish.isError && <p role="alert">{localize('com_hermes_unavailable')}</p>}
        {publish.data && (
          <p role="status">
            {localize(publish.data.ready ? 'com_hermes_published' : 'com_hermes_restart')}
          </p>
        )}
        <nav aria-label={localize('com_hermes_workspace')} className="flex flex-wrap gap-2">
          {hermesSections.map((item) => (
            <Button
              key={item.path}
              variant="outline"
              aria-pressed={section.path === item.path}
              onClick={() => setParams({ section: item.path })}
            >
              {localize(item.key)}
            </Button>
          ))}
        </nav>
      </header>
      {(session.isError || frameError) && (
        <div role="alert" className="p-4">
          <p>{localize('com_hermes_unavailable')}</p>
          <Button
            onClick={() => {
              setReady(false);
              setAttempt((value) => value + 1);
            }}
          >
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}
      {!ready && !session.isError && (
        <p role="status" className="p-3">
          {localize('com_hermes_loading')}
        </p>
      )}
      {ready && !frameError && (
        <>
          {!frameLoaded && (
            <p role="status" className="p-3">
              {localize('com_hermes_loading')}
            </p>
          )}
          <iframe
            ref={frame}
            key={`${src}:${attempt}`}
            src={src}
            title={localize('com_hermes_workspace')}
            allowFullScreen
            className="min-h-[32rem] w-full flex-1 border-0"
            referrerPolicy="same-origin"
            onError={() => setFrameError(true)}
            onLoad={() => {
              try {
                if (frame.current?.contentDocument?.contentType.includes('json'))
                  setFrameError(true);
                else setFrameLoaded(true);
              } catch {
                setFrameError(true);
              }
            }}
          />
        </>
      )}
    </section>
  );
}
