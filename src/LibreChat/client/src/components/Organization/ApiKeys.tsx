import { useEffect, useState } from 'react';
import { Button, Input } from '@librechat/client';
import { useOrganizationKeys } from './keyQueries';
import { useLocalize } from '~/hooks';
export default function ApiKeys() {
  const localize = useLocalize();
  const { page, create, revoke } = useOrganizationKeys();
  const [name, setName] = useState('');
  const [days, setDays] = useState(90);
  const [models, setModels] = useState('Agent: default');
  const [allModels, setAllModels] = useState(false);
  const [secret, setSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const defaultDays = page.data?.defaultExpiryDays;
  useEffect(() => {
    if (defaultDays) setDays(defaultDays);
  }, [defaultDays]);
  const busy = create.isLoading || revoke.isLoading;
  const allowedModels = models
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const submit = async () => {
    if (!allModels && !allowedModels.length) return;
    setCopied(false);
    try {
      const result = await create.mutateAsync({
        name,
        expiryDays: days,
        allowedModels: allModels ? [] : allowedModels,
      });
      setSecret(result.secret);
      create.reset();
      setName('');
    } catch {
      /* Only a localized safe error is rendered. */
    }
  };
  return (
    <section className="border-border-light space-y-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">{localize('com_org_api_title')}</h2>
      <p>{localize('com_org_api_help')}</p>
      {page.isLoading && <p role="status">{localize('com_org_loading')}</p>}
      {(page.isError || create.isError || revoke.isError) && (
        <p role="alert">{localize('com_org_api_error')}</p>
      )}
      {page.data && (
        <>
          <label className="flex flex-col gap-2">
            {localize('com_org_api_base')}
            <Input readOnly value={page.data.baseURL} />
          </label>
          <p>{localize('com_org_api_endpoints')}</p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="flex flex-col gap-2">
              {localize('com_org_api_name')}
              <Input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              {localize('com_org_api_expiry')}
              <Input
                required
                type="number"
                min={1}
                max={page.data.maxExpiryDays}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allModels}
                onChange={(event) => setAllModels(event.target.checked)}
              />
              {localize('com_org_api_all')}
            </label>
            {!allModels && (
              <label className="flex flex-col gap-2">
                {localize('com_org_api_models')}
                <Input
                  required
                  value={models}
                  onChange={(event) => setModels(event.target.value)}
                />
              </label>
            )}
            <Button
              type="submit"
              disabled={busy || !!secret || (!allModels && !allowedModels.length)}
            >
              {localize('com_org_api_create')}
            </Button>
          </form>
          {secret && (
            <div role="status" className="border-border-light space-y-3 rounded-lg border p-3">
              <p>{localize('com_org_api_once')}</p>
              <code className="block break-all">{secret}</code>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(secret)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {localize('com_org_api_copy')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSecret('');
                  setCopied(false);
                }}
              >
                {localize('com_org_api_dismiss')}
              </Button>
              {copied && <p>{localize('com_org_api_copied')}</p>}
            </div>
          )}
          <ul className="divide-border-light divide-y">
            {page.data.keys.map((key) => {
              const expired = Date.parse(key.expiresAt) <= Date.now();
              let status = localize('com_org_api_active');
              if (expired) status = localize('com_org_api_expired');
              if (key.revokedAt) status = localize('com_org_api_revoked');
              return (
                <li key={key.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <strong>{key.name}</strong>
                    <code>{key.prefix}...</code>
                    <span>{status}</span>
                    {!key.revokedAt && !expired && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void revoke.mutateAsync(key.id).catch(() => undefined);
                        }}
                      >
                        {localize('com_org_api_revoke')}
                      </Button>
                    )}
                  </div>
                  <p className="text-text-secondary text-sm">
                    {localize('com_org_api_expires', {
                      0: new Date(key.expiresAt).toLocaleString(),
                    })}
                  </p>
                  <p className="text-text-secondary text-sm break-all">
                    {key.allowedModels.length
                      ? key.allowedModels.join(', ')
                      : localize('com_org_api_all')}
                  </p>
                </li>
              );
            })}
          </ul>
          {page.data.keys.length === 0 && <p>{localize('com_org_api_empty')}</p>}
        </>
      )}
    </section>
  );
}
