import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import { usePlatform } from './queries';
import { useLocalize } from '~/hooks';

export default function PlatformButton() {
  const localize = useLocalize();
  const { status } = usePlatform();
  if (!status.data?.canManage && !status.data?.needsMfa) return null;
  const title = localize('com_platform_title');
  return (
    <TooltipAnchor description={title} side="right">
      <Button asChild variant="nav" size="icon">
        <Link to="/platform" aria-label={title}>
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </Link>
      </Button>
    </TooltipAnchor>
  );
}
