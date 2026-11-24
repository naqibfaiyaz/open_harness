import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import { useOrganization } from './queries';
import { useLocalize } from '~/hooks';

export default function OrganizationButton() {
  const { status } = useOrganization();
  const localize = useLocalize();
  if (!status.data?.enabled) return null;
  const label = localize('com_org_title');
  return (
    <TooltipAnchor description={label} side="right">
      <Button asChild variant="nav" size="icon">
        <Link to="/organization" aria-label={label}>
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </Link>
      </Button>
    </TooltipAnchor>
  );
}
