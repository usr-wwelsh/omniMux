import { describe, it, expect, afterEach } from 'vitest';
import { focusOnMount } from './focusOnMount';

afterEach(() => {
  document.body.innerHTML = '';
});

function mountInput(value = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.value = value;
  document.body.appendChild(input);
  return input;
}

describe('focusOnMount', () => {
  it('focuses the element it is attached to', () => {
    const input = mountInput();
    focusOnMount(input);
    expect(document.activeElement).toBe(input);
  });

  it('selects existing text so typing replaces it', () => {
    const input = mountInput('Road Trip');
    focusOnMount(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Road Trip'.length);
  });

  it('leaves focus alone when disabled', () => {
    const other = mountInput();
    other.focus();
    const input = mountInput();
    focusOnMount(input, false);
    expect(document.activeElement).toBe(other);
  });
});
