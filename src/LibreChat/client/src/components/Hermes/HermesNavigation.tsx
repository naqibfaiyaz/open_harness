import { Link, useSearchParams } from 'react-router-dom';
import { hermesSections } from 'librechat-data-provider';
import { useHermesStatus } from './queries';
import { useLocalize } from '~/hooks';

export default function HermesNavigation() {
  const localize = useLocalize();
  const { data } = useHermesStatus();
  const [params] = useSearchParams();
  const active =
    hermesSections.find((item) => item.path === params.get('section'))?.path ??
    hermesSections[0].path;
  if (!data?.canManage) return null;
  return (
    <nav
      aria-label={localize('com_hermes_workspace')}
      className="flex min-h-0 flex-col gap-1 overflow-y-auto p-3"
    >
      <h2 className="px-3 py-2 text-sm font-semibold">{localize('com_hermes_workspace')}</h2>
      {hermesSections.map((item) => (
        <Link
          key={item.path}
          to={`/hermes?${new URLSearchParams({ section: item.path })}`}
          aria-current={active === item.path ? 'page' : undefined}
          className={`hover:bg-surface-nav-hover rounded-lg px-3 py-2 text-sm ${active === item.path ? 'bg-surface-nav-hover font-semibold' : 'text-text-secondary'}`}
        >
          {localize(item.key)}
        </Link>
      ))}
    </nav>
  );
}
