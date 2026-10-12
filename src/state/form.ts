import type { Material } from '../types';
import type { PersistedForm } from './persistence';

export type FormState = PersistedForm & { materials: Material[] };

export type Store = {
  get: () => FormState;
  set: (patch: Partial<FormState>) => void;
  subscribe: (listener: (state: FormState) => void) => () => void;
};

/** Plain mutable store: one state object, a Set of listeners, no reactivity library. */
export function createStore(initial: FormState): Store {
  let state: FormState = { ...initial };
  const listeners = new Set<(state: FormState) => void>();

  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function bindStore(store: Store, render: (state: FormState) => void): () => void {
  render(store.get());
  return store.subscribe(render);
}
