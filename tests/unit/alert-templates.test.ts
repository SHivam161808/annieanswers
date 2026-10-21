import { describe, expect, it } from 'vitest';
import { loadTemplates, renderTemplate } from '../../src/alerts/templates.js';

describe('loadTemplates', () => {
  it('loads ghl/sms-templates.yaml by default, keyed by id', () => {
    const templates = loadTemplates();
    const t = templates.get('emergency_alert_owner');
    expect(t?.id).toBe('emergency_alert_owner');
    expect(t?.to).toBe('owner');
    expect([...templates.keys()]).toEqual(
      expect.arrayContaining(['enquiry_alert_owner', 'request_mode_owner']),
    );
  });
});

describe('renderTemplate', () => {
  it.each([
    // Spaces inside the braces, and values trimmed.
    [
      'Hi {{ contact.first_name }}, call {{contact.phone}}.',
      { 'contact.first_name': '  Jane ', 'contact.phone': ' 0113 ' },
      'Hi Jane, call 0113.',
    ],
    // Space before punctuation left by an empty field goes; the punctuation stays.
    ['Hi {{contact.first_name}}, there', {}, 'Hi, there'],
    // Runs of punctuation left by empty fields collapse to the first mark.
    ['URGENT:{{contact.a}}.,. Call', {}, 'URGENT: Call'],
    // Empty brackets go; brackets with content stay.
    ['Call Jane ({{contact.phone}}) now', {}, 'Call Jane now'],
    ['Call Jane ( {{contact.phone}} ) now', {}, 'Call Jane now'],
    ['Jane (owner) called', {}, 'Jane (owner) called'],
    ['Call ({{contact.phone}})', { 'contact.phone': ' 0113 ' }, 'Call (0113)'],
    // Double spaces from an empty field become one; line breaks are kept; ends trimmed.
    ['Call {{contact.x}} now', {}, 'Call now'],
    ['Line one\nLine two', {}, 'Line one\nLine two'],
    ['  {{contact.x}} Hello {{contact.y}}  ', { 'contact.x': null }, 'Hello'],
  ] as const)('%j', (body, values, out) => expect(renderTemplate(body, values)).toBe(out));
});
