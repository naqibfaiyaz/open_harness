import { Input } from '@librechat/client';
import { useLocalize } from '~/hooks';

const oidc = [
  { name: 'clientId', label: 'com_org_client_id' },
  { name: 'clientSecret', label: 'com_org_client_secret', secret: true },
  { name: 'issuer', label: 'com_org_issuer' },
  { name: 'authorizationUrl', label: 'com_org_authorization' },
  { name: 'tokenUrl', label: 'com_org_token' },
  { name: 'userInfoUrl', label: 'com_org_userinfo' },
  { name: 'jwksUrl', label: 'com_org_jwks' },
] as const;
const saml = [
  { name: 'singleSignOnServiceUrl', label: 'com_org_saml_url' },
  { name: 'idpEntityId', label: 'com_org_entity' },
  { name: 'signingCertificate', label: 'com_org_certificate' },
] as const;
export default function Fields({
  provider,
  settings,
  onChange,
}: {
  provider: string;
  settings: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const localize = useLocalize();
  return (
    <div className="space-y-3">
      {(provider === 'oidc' ? oidc : saml).map((field) => (
        <label key={field.name} className="flex flex-col gap-2">
          {localize(field.label)}
          <Input
            type={'secret' in field ? 'password' : 'text'}
            autoComplete="off"
            required={field.name !== 'userInfoUrl'}
            value={settings[field.name] ?? ''}
            onChange={(e) => onChange({ ...settings, [field.name]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
