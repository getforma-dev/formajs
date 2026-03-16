import { describe, it, expect } from 'vitest';
import { getSwapTag, getSwapScript } from '../client-script';

describe('getSwapTag', () => {
  it('does not contain literal </script> in output', () => {
    const tag = getSwapTag('s:0', '</script><script>alert(1)</script>');
    // Count </script> occurrences — should only be the closing tag of the wrapper
    const matches = tag.match(/<\/script>/g);
    expect(matches).toHaveLength(1); // only the final closing tag
  });

  it('escapes < as \\u003c in serialized content', () => {
    const tag = getSwapTag('s:0', '<div>hello</div>');
    // The < inside the JSON string should be escaped
    expect(tag).toContain('\\u003c');
    expect(tag).not.toMatch(/\$FORMA_SWAP\([^)]*<div>/); // no literal <div> in the call
  });

  it('preserves content after client-side parsing', () => {
    const tag = getSwapTag('s:0', '<b>bold</b>');
    // Extract the second argument and parse it
    const match = tag.match(/\$FORMA_SWAP\(([^,]+),(.+)\)<\/script>$/);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![2]!);
    expect(parsed).toBe('<b>bold</b>');
  });

  it('handles quotes and backslashes in content', () => {
    const tag = getSwapTag('s:0', 'He said "hello\\world"');
    const match = tag.match(/\$FORMA_SWAP\(([^,]+),(.+)\)<\/script>$/);
    const parsed = JSON.parse(match![2]!);
    expect(parsed).toBe('He said "hello\\world"');
  });

  it('handles empty string content', () => {
    const tag = getSwapTag('s:0', '');
    expect(tag).toContain('$FORMA_SWAP');
  });
});

describe('getSwapScript', () => {
  it('returns a script with $FORMA_SWAP function definition', () => {
    const script = getSwapScript();
    expect(script).toContain('function $FORMA_SWAP');
    expect(script).toContain('<script>');
    expect(script).toContain('</script>');
  });
});
