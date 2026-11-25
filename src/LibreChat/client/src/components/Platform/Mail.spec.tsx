import { render, screen } from '@testing-library/react';
import Mail from './Mail';
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
const settings = {
  enabled: false,
  requestedEnabled: false,
  host: 'smtp.example.test',
  port: 587,
  sender: 'signup@example.test',
  username: 'smtp-user',
  passwordConfigured: true,
};
it('shows stored configuration without returning or prefilling the SMTP password', () => {
  render(<Mail settings={settings} busy={false} onSave={jest.fn()} />);
  expect(screen.getByLabelText('com_signup_smtp_host')).toHaveValue('smtp.example.test');
  expect(screen.getByLabelText('com_signup_smtp_password')).toHaveValue('');
  expect(screen.getByText('com_signup_secret_saved')).toBeInTheDocument();
});
it('requires an administrative reason before saving', () => {
  render(<Mail settings={settings} busy={true} onSave={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'com_signup_save' })).toBeDisabled();
});
