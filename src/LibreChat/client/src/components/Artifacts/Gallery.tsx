import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '@librechat/client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { artifactGalleryPath, QueryKeys } from 'librechat-data-provider';
import type { ArtifactGalleryPage } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';
import Thumbnail from './Thumbnail';

export default function Gallery() {
  const localize = useLocalize();
  const { token, user } = useAuthContext();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const result = useInfiniteQuery(
    [QueryKeys.artifactGallery, user?.id, query],
    async ({ pageParam }) => {
      const params = new URLSearchParams({ q: query });
      if (pageParam) params.set('before', String(pageParam));
      const base = document.querySelector('base')?.getAttribute('href') ?? '/';
      const response = await fetch(`${base.replace(/\/$/, '')}${artifactGalleryPath}?${params}`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (!response.ok) throw new Error('ARTIFACT_GALLERY_UNAVAILABLE');
      return response.json() as Promise<ArtifactGalleryPage>;
    },
    { enabled: !!token && !!user?.id, getNextPageParam: (page) => page.nextCursor },
  );
  const seen = new Set<string>();
  const artifacts = (result.data?.pages.flatMap((page) => page.artifacts) ?? []).filter(
    (artifact) => {
      const key = `${artifact.conversationId}:${artifact.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );
  return (
    <main className="text-text-primary mx-auto w-full max-w-6xl space-y-6 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{localize('com_gallery_title')}</h1>
      <p>{localize('com_gallery_scope')}</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
        }}
      >
        <Input
          aria-label={localize('com_gallery_search')}
          placeholder={localize('com_gallery_search')}
          maxLength={100}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit">{localize('com_ui_search')}</Button>
      </form>
      {result.isLoading && <p role="status">{localize('com_platform_loading')}</p>}
      {result.isError && (
        <div role="alert">
          <p>{localize('com_gallery_error')}</p>
          <Button onClick={() => void result.refetch()}>{localize('com_gallery_retry')}</Button>
        </div>
      )}
      {!result.isLoading && !result.isError && artifacts.length === 0 && (
        <p role="status">{localize('com_gallery_empty')}</p>
      )}
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {artifacts.map((artifact) => (
          <li key={`${artifact.conversationId}:${artifact.id}`}>
            <Link
              className="border-border-light hover:bg-surface-hover block space-y-3 rounded-xl border p-3"
              to={`/c/${encodeURIComponent(artifact.conversationId)}?artifact=${encodeURIComponent(artifact.id)}&artifactMessage=${encodeURIComponent(artifact.messageId)}`}
            >
              <Thumbnail content={artifact.content} type={artifact.type} title={artifact.title} />
              <strong className="block truncate">{artifact.title}</strong>
              <span className="text-text-secondary block text-sm">
                {localize('com_gallery_open')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {result.hasNextPage && (
        <Button disabled={result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>
          {localize('com_gallery_more')}
        </Button>
      )}
    </main>
  );
}
