import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import unittest
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('reporting_policy', Path(__file__).resolve().parents[1] / 'integrations/hermes-titles/__init__.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ReportingPolicyTests(unittest.TestCase):
    def setUp(self):
        self.old = os.environ.get('HERMES_BRIDGE_KEY')
        os.environ['HERMES_BRIDGE_KEY'] = 'fixture-test-key'
        self.context = {'version': 1, 'asOf': datetime.now(timezone.utc).isoformat(), 'status': 'resolved', 'timeZone': 'America/Toronto', 'period': {
            'startDate': '2026-10-01', 'endDateExclusive': '2026-11-01',
            'startUTC': '2026-10-01T04:00:00Z', 'endUTCExclusive': '2026-11-01T04:00:00Z'}}
        self.capture()

    def tearDown(self):
        policy._contexts.clear()
        if self.old is None:
            os.environ.pop('HERMES_BRIDGE_KEY', None)
        else:
            os.environ['HERMES_BRIDGE_KEY'] = self.old

    def capture(self, signature=None):
        payload = base64.urlsafe_b64encode(json.dumps(self.context).encode()).decode().rstrip('=')
        signature = signature or hmac.new(b'fixture-test-key', ('reporting-v1:' + payload).encode(), hashlib.sha256).hexdigest()
        policy.capture(system_prompt=f'[OPEN_HARNESS_REPORTING:{payload}.{signature}]', session_id='owner', turn_id='turn')

    def query(self, domain, **kw):
        return policy.guard(tool_name='tool_call', args={'calls': [{'name': 'mcp__Odoo__ai_tool_read_group', 'arguments': {'model_name': 'sale.order', 'domain': domain}}]}, session_id=kw.get('session', 'owner'), turn_id='turn')

    def test_wrong_month_unbounded_and_or_are_blocked(self):
        for domain in ([], [['date_order', '>=', '2026-06-01'], ['date_order', '<', '2026-07-01']], ['|', ['date_order', '>=', '2026-10-01T04:00:00Z'], ['date_order', '<', '2026-11-01T04:00:00Z']]):
            self.assertEqual(self.query(domain)['action'], 'block')

    def test_exact_utc_bounds_and_date_only_bounds(self):
        domain = [['date_order', '>=', '2026-10-01 04:00:00'], ['date_order', '<', '2026-11-01 04:00:00'], ['state', '=', 'sale']]
        self.assertIsNone(self.query(domain))
        self.assertIsNone(policy.validate_domain({'model_name': 'account.move', 'domain': [['invoice_date', '>=', '2026-10-01'], ['invoice_date', '<', '2026-11-01']]}, self.context['period']))

    def test_signature_scope_expiry_and_cleanup(self):
        self.assertIsNone(self.query([], session='another-user'))
        self.capture('0' * 64)
        self.assertIsNone(self.query([]))
        self.context['asOf'] = '2020-01-01T00:00:00Z'
        self.capture()
        self.assertIsNone(self.query([]))

    def test_assistant_envelope_and_anthropic_blocks_are_captured(self):
        payload = base64.urlsafe_b64encode(json.dumps(self.context).encode()).decode().rstrip('=')
        signature = hmac.new(b'fixture-test-key', ('reporting-v1:' + payload).encode(), hashlib.sha256).hexdigest()
        text = f'Prior assistant reply. Trusted request clock and reporting context [OPEN_HARNESS_REPORTING:{payload}.{signature}]'
        policy.capture(system_prompt='static policy', request_messages=[{'role': 'assistant', 'content': [{'type': 'text', 'text': text}]}], session_id='owner', turn_id='turn')
        self.assertEqual(self.query([])['action'], 'block')

    def test_discovery_allowed_but_multiple_period_data_read_blocked(self):
        self.context['status'] = 'clarification_required'
        self.context.pop('period')
        self.capture()
        self.assertEqual(self.query([])['action'], 'block')
        self.assertIsNone(policy.guard(tool_name='mcp__Odoo__ai_tool_get_fields', args={'model_name': 'sale.order'}, session_id='owner', turn_id='turn'))


if __name__ == '__main__':
    unittest.main()
