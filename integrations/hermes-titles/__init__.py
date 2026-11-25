"""Reporting policy for the pinned Hermes hook API; dashboard APIs remain separate."""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone

_contexts = {}
_lock = threading.Lock()
_logger = logging.getLogger(__name__)
_MARKER = re.compile(r'\[OPEN_HARNESS_REPORTING:([A-Za-z0-9_-]+)\.([a-f0-9]{64})\]')
_FIELDS = {'sale.order': 'date_order', 'sale.order.line': 'order_id.date_order',
           'account.move': 'invoice_date', 'account.move.line': 'date',
           'sale.report': 'date'}


def capture(system_prompt='', session_id='', turn_id='', **_):
    """Only a bridge-signed system context may establish a policy for this turn."""
    key = (session_id, turn_id)
    context = None
    secret = os.environ.get('HERMES_BRIDGE_KEY', '')
    # Anthropic uses content blocks while OpenAI-compatible providers use a string.
    if isinstance(system_prompt, list):
        system_prompt = '\n'.join(part.get('text', '') for part in system_prompt if isinstance(part, dict))
    if secret and isinstance(system_prompt, str):
        for payload, signature in _MARKER.findall(system_prompt):
            expected = hmac.new(secret.encode(), ('reporting-v1:' + payload).encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                continue
            try:
                candidate = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
                age = time.time() - datetime.fromisoformat(candidate['asOf'].replace('Z', '+00:00')).timestamp()
                if candidate.get('version') == 1 and -60 <= age < 86400:
                    context = candidate
            except (ValueError, KeyError, TypeError):
                continue
    with _lock:
        # Bound abandoned turns; retries replace their own entry, never another user's.
        for old, (_, expiry) in list(_contexts.items()):
            if expiry < time.monotonic():
                _contexts.pop(old, None)
        if len(_contexts) < 1024 or key in _contexts:
            _contexts[key] = (context, time.monotonic() + 86400)


def _bound(value, timestamp):
    if not isinstance(value, str):
        raise ValueError('Expected a date string')
    if timestamp:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        # Odoo's timezone-naive timestamp wire format is UTC, unlike date-only fields.
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    return datetime.strptime(value, '%Y-%m-%d').date()


def validate_domain(args, period):
    """Require exact, same-field half-open bounds; reject OR/NOT or opaque domains."""
    model = args.get('model_name', args.get('model'))
    field = _FIELDS.get(model)
    if not field:
        return None
    domain = args.get('domain')
    if isinstance(domain, str):
        try:
            domain = json.loads(domain)
        except ValueError:
            return 'Use a JSON domain so its reporting dates can be validated.'
    if not isinstance(domain, list):
        return 'A bounded reporting domain is required.'
    timestamp = model not in ('account.move', 'account.move.line')
    start = _bound(period['startUTC'] if timestamp else period['startDate'], timestamp)
    end = _bound(period['endUTCExclusive'] if timestamp else period['endDateExclusive'], timestamp)
    lower = upper = False
    for term in domain:
        if term == '&':
            continue
        if not isinstance(term, (tuple, list)) or len(term) != 3:
            return 'Use conjunctive date filters; OR/NOT reporting domains require explicit review.'
        name, operator, value = term
        if name == field:
            try:
                actual = _bound(value, timestamp)
            except (ValueError, TypeError):
                return 'Reporting dates must use explicit ISO values.'
            if operator == '>=' and actual == start:
                lower = True
            elif operator == '<' and actual == end:
                upper = True
            else:
                return 'The query dates do not match the requested reporting period.'
    if not (lower and upper):
        return 'Use both >= start and < end on ' + field + ' for the requested reporting period.'
    return None


def _calls(tool_name, args):
    if tool_name == 'tool_call':
        for call in args.get('calls', []):
            yield from _calls(call.get('name', ''), call.get('arguments', {}))
    else:
        yield tool_name, args


def guard(tool_name='', args=None, session_id='', turn_id='', **_):
    with _lock:
        stored = _contexts.get((session_id, turn_id))
    if not stored or not stored[0]:
        return None  # Native, non-LibreChat sessions retain their existing behavior.
    context = stored[0]
    period = context.get('period')
    if not period and context.get('status') != 'clarification_required':
        return None
    try:
        for name, arguments in _calls(tool_name, args or {}):
            # Schema discovery is harmless; validate data reads, including lazy MCP batches.
            if 'get_fields' in name or 'initial_context' in name:
                continue
            if 'Odoo' not in name and arguments.get('model_name', arguments.get('model')) not in _FIELDS:
                continue
            if context['status'] == 'clarification_required':
                reason = 'Ask the user which exact reporting period to query first.'
            else:
                reason = validate_domain(arguments, period)
            if reason:
                _logger.warning('reporting_period_validation decision=blocked timezone=%s start=%s end=%s',
                                context['timeZone'], period and period['startDate'], period and period['endDateExclusive'])
                return {'action': 'block', 'message': 'REPORTING_PERIOD_MISMATCH: ' + reason +
                        ' Trusted reporting context: ' + json.dumps(context)}
        return None
    except (TypeError, ValueError, KeyError, AttributeError):
        return {'action': 'block', 'message': 'REPORTING_PERIOD_VALIDATION_FAILED: use structured reporting filters.'}


def cleanup(session_id='', turn_id='', **_):
    with _lock:
        _contexts.pop((session_id, turn_id), None)


def register(ctx):
    ctx.register_hook('pre_api_request', capture)
    ctx.register_hook('pre_tool_call', guard)
    ctx.register_hook('on_session_end', cleanup)
