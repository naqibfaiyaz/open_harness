import { Bot } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, TooltipAnchor } from '@librechat/client';
import { useHermesStatus } from './queries';
import { useLocalize } from '~/hooks';

export default function HermesButton({
  onNavigate,
  layout = 'icon',
}: {
  onNavigate?: () => void;
  layout?: 'icon' | 'row';
}) {
  const { data } = useHermesStatus();
  const localize = useLocalize();
  if (!data?.enabled || !data.canManage) return null;
  const label = localize('com_hermes_workspace');
  const button = (
    <Button asChild variant="nav" size={layout === 'row' ? 'row' : 'icon'}>
      <Link to="/hermes" onClick={onNavigate} aria-label={label}>
        <Bot className="h-5 w-5 shrink-0" aria-hidden="true" />
        {layout === 'row' && <span>{label}</span>}
      </Link>
    </Button>
  );
  return layout === 'row' ? (
    button
  ) : (
    <TooltipAnchor description={label} side="right">
      {button}
    </TooltipAnchor>
  );
}
