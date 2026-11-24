import { Button } from '@librechat/client';
import { Link, useSearchParams } from 'react-router-dom';
import { hermesSections } from 'librechat-data-provider';
import { useHermesStatus, useHermesProfiles, usePublishHermesProfile } from './queries';
import { useLocalize } from '~/hooks';

export default function HermesNavigation() {
  const localize = useLocalize();
  const { data } = useHermesStatus();
  const profiles = useHermesProfiles(data?.canManage === true);
  const publish = usePublishHermesProfile();
  const [params, setParams] = useSearchParams();
  const profile = params.get('profile') || 'default';
  const active =
    hermesSections.find((item) => item.path === params.get('section'))?.path ??
    hermesSections[0].path;
  if (!data?.canManage) return null;
  return (
    <section className="bg-surface-sidebar text-text-primary flex h-full min-h-0 flex-col">
      <div className="border-border-light shrink-0 space-y-3 border-b p-3">
        <h1 className="text-sm font-semibold">{localize('com_hermes_workspace')}</h1>
        <p className="sr-only">{localize('com_hermes_scope')}</p>
        <label className="text-text-secondary flex flex-col gap-2 text-xs">
          {localize('com_hermes_agents')}
          <select
            value={profile}
            onChange={(event) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set('profile', event.target.value);
                return next;
              })
            }
            className="border-border-light bg-surface-sidebar text-text-primary w-full rounded-lg border p-2 text-sm"
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
          className="w-full"
          onClick={() => void profiles.refetch()}
          disabled={profiles.isFetching}
        >
          {localize('com_hermes_refresh')}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => publish.mutate(profile)}
          disabled={publish.isLoading}
        >
          {localize('com_hermes_publish')}
        </Button>
        {(profiles.isError || publish.isError) && (
          <p role="alert" className="text-sm">
            {localize('com_hermes_unavailable')}
          </p>
        )}
        {publish.data && (
          <p role="status" className="text-text-secondary text-sm">
            {localize(publish.data.ready ? 'com_hermes_published' : 'com_hermes_restart')}
          </p>
        )}
      </div>
      <nav
        aria-label={localize('com_hermes_workspace')}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
      >
        {hermesSections.map((item) => (
          <Link
            key={item.path}
            to={`/hermes?${new URLSearchParams({ section: item.path, profile })}`}
            aria-current={active === item.path ? 'page' : undefined}
            className={`hover:bg-surface-nav-hover rounded-lg px-3 py-2 text-sm ${active === item.path ? 'bg-surface-nav-hover font-semibold' : 'text-text-secondary'}`}
          >
            {localize(item.key)}
          </Link>
        ))}
      </nav>
    </section>
  );
}
