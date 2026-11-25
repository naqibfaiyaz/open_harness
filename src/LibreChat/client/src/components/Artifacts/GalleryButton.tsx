import { Images } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';
export default function GalleryButton() {
  const localize = useLocalize();
  const title = localize('com_gallery_title');
  return (
    <TooltipAnchor description={title} side="right">
      <Button asChild variant="nav" size="icon">
        <Link to="/artifacts" aria-label={title}>
          <Images className="size-5" aria-hidden="true" />
        </Link>
      </Button>
    </TooltipAnchor>
  );
}
