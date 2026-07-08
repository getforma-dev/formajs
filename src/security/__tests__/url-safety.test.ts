import { describe, it, expect } from 'vitest';
import {
  isDangerousUrl,
  isEventHandlerAttr,
  isSafeAttrName,
  isUrlAttr,
} from '../url-safety.js';

const TAB = String.fromCharCode(0x09);
const LF = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);
const NUL = String.fromCharCode(0x00);
const SOH = String.fromCharCode(0x01);

describe('isDangerousUrl', () => {
  it('flags plain javascript:/vbscript: and data:text/html', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('vbscript:msgbox(1)')).toBe(true);
    expect(isDangerousUrl('data:text/html,<script>alert(1)</script>')).toBe(true);
    expect(isDangerousUrl('JavaScript:alert(1)')).toBe(true);
  });

  // Regression: browsers strip tabs/newlines/control chars from the scheme
  // before interpreting it, so these execute despite the naive regex.
  it('flags schemes obfuscated with embedded control characters', () => {
    expect(isDangerousUrl('java' + TAB + 'script:alert(1)')).toBe(true);
    expect(isDangerousUrl('javas' + LF + 'cript:alert(1)')).toBe(true);
    expect(isDangerousUrl('java' + CR + LF + 'script:alert(1)')).toBe(true);
    expect(isDangerousUrl(NUL + 'javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl(SOH + 'javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('  ' + TAB + ' javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('java script:alert(1)')).toBe(true);
  });

  it('allows ordinary URLs', () => {
    expect(isDangerousUrl('https://example.com')).toBe(false);
    expect(isDangerousUrl('/relative/path')).toBe(false);
    expect(isDangerousUrl('mailto:a@b.com')).toBe(false);
    expect(isDangerousUrl('#anchor')).toBe(false);
    expect(isDangerousUrl('data:image/png;base64,iVBOR')).toBe(false); // safe inline image
  });
});

describe('isEventHandlerAttr', () => {
  it('matches on* names case-insensitively', () => {
    expect(isEventHandlerAttr('onclick')).toBe(true);
    expect(isEventHandlerAttr('OnClick')).toBe(true);
    expect(isEventHandlerAttr('ONMOUSEOVER')).toBe(true);
  });
  it('does not match ordinary attributes', () => {
    expect(isEventHandlerAttr('class')).toBe(false);
    expect(isEventHandlerAttr('href')).toBe(false);
    expect(isEventHandlerAttr('data-on')).toBe(false);
  });
});

describe('isSafeAttrName', () => {
  it('accepts well-formed names', () => {
    expect(isSafeAttrName('href')).toBe(true);
    expect(isSafeAttrName('data-x')).toBe(true);
    expect(isSafeAttrName('xlink:href')).toBe(true);
    expect(isSafeAttrName('aria-label')).toBe(true);
  });
  it('rejects names that would inject new attributes', () => {
    expect(isSafeAttrName('x onclick=alert(1)')).toBe(false);
    expect(isSafeAttrName('x"onload="y')).toBe(false);
    expect(isSafeAttrName('x/y')).toBe(false);
    expect(isSafeAttrName('')).toBe(false);
  });
});

describe('isUrlAttr', () => {
  it('identifies URL-bearing attributes case-insensitively', () => {
    expect(isUrlAttr('href')).toBe(true);
    expect(isUrlAttr('HREF')).toBe(true);
    expect(isUrlAttr('src')).toBe(true);
    expect(isUrlAttr('formaction')).toBe(true);
    expect(isUrlAttr('xlink:href')).toBe(true);
    expect(isUrlAttr('class')).toBe(false);
  });
});
