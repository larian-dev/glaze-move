export type Child = Node | string | null | undefined;

export type ElProps = {
  class?: string;
  text?: string;
  type?: string;
  /** Value of an `<input>`/`<select>` node; set it again after appending `<option>` children. */
  value?: string;
  disabled?: boolean;
  attrs?: Record<string, string>;
};

/** Creates an element, applies the given properties and appends the children. */
export function el<E extends keyof HTMLElementTagNameMap>(
  tag: E,
  props: ElProps = {},
  children: Child | Child[] = [],
): HTMLElementTagNameMap[E] {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.type !== undefined) node.setAttribute('type', props.type);
  if (props.disabled === true) node.setAttribute('disabled', '');
  const valued = node instanceof HTMLInputElement || node instanceof HTMLSelectElement;
  if (props.value !== undefined && valued) node.value = props.value;
  for (const [name, value] of Object.entries(props.attrs ?? {})) node.setAttribute(name, value);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function option(value: string, label: string, selected = false): HTMLOptionElement {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  node.selected = selected;
  return node;
}

export function setText(node: Element, text: string): void {
  node.textContent = text;
}

export function fmt(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** A pill switch: a track-and-knob graphic with `aria-checked` carrying the
 * value. `label` is the accessible name and, unless `showLabel` is false, the
 * visible text beside the knob — row switches lean on their row for context
 * and keep only the knob. */
export function switchToggle(
  checked: () => boolean,
  label: string,
  onChange: (value: boolean) => void,
  showLabel = true,
): HTMLButtonElement {
  const track = el('span', { class: 'recipe-toggle-track', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { class: 'recipe-toggle-knob' }),
  ]);
  const children = showLabel
    ? [track, el('span', { class: 'recipe-toggle-label', text: label })]
    : [track];
  const button = el(
    'button',
    {
      type: 'button',
      class: 'recipe-toggle',
      attrs: {
        role: 'switch',
        'aria-checked': String(checked()),
        'aria-label': label,
      },
    },
    children,
  );
  button.addEventListener('click', () => {
    const next = !checked();
    onChange(next);
    button.setAttribute('aria-checked', String(next));
  });
  return button;
}

/** A cycling switch: one button that steps through a setting's values and names
 *  the state it is in, so a three-way clamp needs neither a radio group nor a
 *  legend. The value rides `data-state` for styling; the label is the
 *  accessible name. */
export function cycleToggle<T extends string>(
  values: readonly T[],
  current: () => T,
  label: (value: T) => string,
  onChange: (value: T) => void,
): HTMLButtonElement {
  const button = el('button', { type: 'button', class: 'recipe-toggle recipe-cycle' });
  const paint = (value: T): void => {
    setText(button, label(value));
    button.dataset.state = value;
  };
  paint(current());
  button.addEventListener('click', () => {
    // An unknown current value cycles to the first state rather than nowhere.
    const next = values[(values.indexOf(current()) + 1) % values.length];
    if (next === undefined) return;
    onChange(next);
    paint(next);
  });
  return button;
}